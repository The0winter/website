"""Install Cloudflare real IP handling and bounded public request diagnostics.

Run as root on the existing VPS, first in observe mode, then enforce after the
public DNS/HTTPS checks pass. Dry run is default. Never restarts app services,
changes TLS certificates, firewall rules, or the current application release.
"""
import argparse
import datetime
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import subprocess
import urllib.request

SITE = Path('/etc/nginx/sites-available/test1')
HTTP = Path('/etc/nginx/test1-edge-http.conf')
HTTPS = Path('/etc/nginx/test1-edge-https.conf')
ROTATE = Path('/etc/logrotate.d/test1-public-traffic')
LOG = '/var/log/nginx/test1-public-traffic.jsonl'


def networks():
    request = urllib.request.Request('https://api.cloudflare.com/client/v4/ips',
                                     headers={'User-Agent': 'Shiye-Edge-Configuration/1.0'})
    with urllib.request.urlopen(request, timeout=15) as r:
        response = json.load(r)
    assert response.get('success') is True
    result = []
    for version in (4, 6):
        rows = [ipaddress.ip_network(s) for s in response['result'][f'ipv{version}_cidrs']]
        assert 5 <= len(rows) <= 100 and all(n.version == version and n.prefixlen > 0 for n in rows)
        result.extend(map(str, rows))
    return result


def http_config(cidrs):
    trusted = '\n'.join(f'set_real_ip_from {n};' for n in cidrs)
    geo = '\n'.join(f'    {n} 1;' for n in cidrs)
    return f'''# Managed by infra/cloudflare-edge.py; trust headers only from Cloudflare peers.
{trusted}
real_ip_header CF-Connecting-IP;
real_ip_recursive on;
geo $realip_remote_addr $test1_from_cloudflare {{
    default 0;
{geo}
}}
geo $realip_remote_addr $test1_edge_allowed {{
    default 0;
    127.0.0.1/32 1;
    ::1/128 1;
{geo}
}}
map $test1_from_cloudflare $test1_edge_ray {{ default ""; 1 $http_cf_ray; }}
map $uri $test1_trace_public {{
    default 0;
    / 1;
    "~^/(book(?:/|$)|books(?:/|$)|ranking(?:/|$)|sitemap[^/]*\\.xml$|sitemaps/|robots\\.txt$|api/(books|chapters)(/|$))" 1;
}}
# No query strings, cookies, authorization, request bodies or personal endpoints.
log_format test1_public_traffic escape=json '{{"time":"$time_iso8601","requestId":"$request_id","method":"$request_method","path":"$uri","status":$status,"seconds":$request_time,"bytes":$body_bytes_sent,"client":"$remote_addr","peer":"$realip_remote_addr","cloudflare":$test1_from_cloudflare,"ray":"$test1_edge_ray","userAgent":"$http_user_agent"}}';
'''


def site_config(original):
    result = original
    include = f'include {HTTP};'
    if include not in result:
        result = include + '\n' + result
    log = f'access_log {LOG} test1_public_traffic if=$test1_trace_public;'
    if log not in result:
        anchor = 'access_log /var/log/nginx/test1-access.log test1_json;'
        assert result.count(anchor) == 1, 'Unexpected access log configuration'
        result = result.replace(anchor, anchor + '\n    ' + log)
    include = f'include {HTTPS};'
    count = result.count(include)
    assert count in (0, 2), 'Unexpected HTTPS include count'
    if count == 0:
        anchor = 'ssl_protocols TLSv1.2 TLSv1.3;'
        assert result.count(anchor) == 2, 'Expected primary and www HTTPS servers'
        result = result.replace(anchor, anchor + '\n    ' + include)
    return result


def write(path, data, mode=0o644):
    tmp = path.with_name(path.name + '.edge-next')
    tmp.write_bytes(data)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def run(*args):
    p = subprocess.run(args, capture_output=True, text=True)
    if p.returncode:
        raise RuntimeError(p.stdout + p.stderr)
    return p.stdout + p.stderr


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['observe', 'enforce'], required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    with open('/run/lock/test1-cloudflare-edge.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        cidrs = networks()
        original = SITE.read_bytes()
        guard = '# Observe only: enable enforce after DNS propagation and public verification.\n'
        if args.mode == 'enforce':
            guard = '# Permit Cloudflare and loopback peers; spoofed HTTP headers cannot bypass this.\nif ($test1_edge_allowed = 0) { return 403; }\n'
        changes = {
            SITE: site_config(original.decode()).encode(),
            HTTP: http_config(cidrs).encode(),
            HTTPS: guard.encode(),
            ROTATE: f'''{LOG} {{
    daily
    rotate 7
    maxage 7
    maxsize 20M
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        /usr/sbin/nginx -s reopen
    endscript
}}
'''.encode(),
        }
        before = {p: p.read_bytes() if p.exists() else None for p in changes}
        changed = [str(p) for p, data in changes.items() if before[p] != data]
        result = {'mode': args.mode, 'apply': args.apply, 'cidrs': len(cidrs), 'changed': changed}
        if args.apply and changed:
            assert SITE.read_bytes() == original, 'Site changed concurrently; retry inspection'
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            backup = Path('/var/lib/test1-edge-backups') / stamp
            backup.mkdir(parents=True, mode=0o700)
            manifest = {}
            for path, data in before.items():
                manifest[str(path)] = None if data is None else hashlib.sha256(data).hexdigest()
                if data is not None:
                    (backup / path.name).write_bytes(data)
            (backup / 'manifest.json').write_text(json.dumps(manifest, indent=2))
            try:
                for path, data in changes.items():
                    write(path, data)
                run('nginx', '-t')
                os.chmod(LOG, 0o640)
                run('logrotate', '--debug', str(ROTATE))
                run('systemctl', 'reload', 'nginx')
            except Exception:
                for path, data in before.items():
                    if data is None:
                        path.unlink(missing_ok=True)
                    else:
                        write(path, data)
                run('nginx', '-t')
                run('systemctl', 'reload', 'nginx')
                raise
            result['backup'] = str(backup)
        print(json.dumps(result))


if __name__ == '__main__':
    main()
