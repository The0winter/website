"""Warm a prepared frontend on port 3001 before switching the existing service.

Run on the VPS as root: python3 infra/activate-web-release.py RELEASE
The release must have a committed manifest and test1-seo-preview already running.
Run again with --accept after public verification, or --rollback on failure.
No database, API service, certificate or unrelated nginx settings are changed.
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import time
import urllib.request

ROOT = pathlib.Path('/srv/test1')
NGINX = pathlib.Path('/etc/nginx/sites-available/test1')
ENV = pathlib.Path('/etc/test1/web.env')
NODE = '/opt/node-v22.23.2-linux-x64/bin/node'

def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout

def write(path, data, mode=0o644):
    temp = path.with_name(path.name + '.seo-next')
    temp.write_bytes(data if isinstance(data, bytes) else data.encode())
    os.chmod(temp, mode)
    os.replace(temp, path)

def switch(release):
    temp = ROOT / 'current-seo-next'
    assert not temp.exists() and not temp.is_symlink()
    temp.symlink_to(release)
    os.replace(temp, ROOT / 'current')

def ready(port):
    for attempt in range(30):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=15) as response:
                assert response.status == 200 and b'book-search-field' in response.read()
            return
        except Exception:
            if attempt == 29: raise
            time.sleep(1)

def route(config, port):
    text, count = re.subn(r'(upstream test1_web \{ server 127\.0\.0\.1:)\d+(;)', lambda m: m[1] + str(port) + m[2], config)
    assert count == 1, 'Expected exactly one frontend upstream'
    write(NGINX, text)
    run('nginx', '-t')
    run('systemctl', 'reload', 'nginx')

def rollback(manifest):
    backup = pathlib.Path(manifest['configurationBackup'])
    old = pathlib.Path(manifest['previousRelease'])
    assert old.is_dir()
    write(ENV, (backup / 'web.env').read_bytes(), 0o600)
    switch(old)
    run('systemctl', 'restart', 'test1-web')
    ready(3000)
    write(NGINX, (backup / 'nginx.conf').read_bytes())
    run('nginx', '-t')
    run('systemctl', 'reload', 'nginx')
    print('ROLLED_BACK ' + str(old), flush=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('release', type=pathlib.Path)
    parser.add_argument('--accept', action='store_true')
    parser.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    new = args.release.resolve()
    assert new.parent == ROOT / 'releases' and new.is_dir()
    file = new / 'deployment-manifest.json'
    manifest = json.loads(file.read_text())
    assert manifest['release'] == str(new)
    assert re.fullmatch('[a-f0-9]{40}', manifest.get('sourceCommit') or ''), 'Commit and push before activation'
    old = pathlib.Path(manifest['previousRelease'])
    if args.rollback:
        assert (ROOT / 'current').resolve() == new
        rollback(manifest)
        return
    if args.accept:
        assert (ROOT / 'current').resolve() == new
        report = json.loads(run(NODE, str(new / 'infra/check-seo.mjs'), 'https://jiutianxiaoshuo.com', 'https://jiutianxiaoshuo.com', '--sitemaps'))
        manifest['activatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        manifest['acceptance'] = report
        write(file, json.dumps(manifest, indent=2))
        # Retire the bridge only after old nginx workers have finished in-flight reads.
        time.sleep(20)
        run('systemctl', 'stop', 'test1-seo-preview')
        run('systemctl', 'start', 'test1-release-prune.service')
        print(json.dumps({'accepted': str(new), 'sourceCommit': manifest['sourceCommit'], 'sitemapUrls': report['urls']}))
        return

    assert (ROOT / 'current').resolve() == old, 'Another deployment changed current; rebuild on that release'
    assert json.loads((old / 'deployment-manifest.json').read_text()).get('activatedAt'), 'Previous release is still being verified'
    for row in manifest['files']:
        assert hashlib.sha256((new / row['path']).read_bytes()).hexdigest() == row['sha256'], row['path']
    for name, digest in manifest['preservedFiles'].items():
        assert hashlib.sha256((old / name).read_bytes()).hexdigest() == digest, name
        assert hashlib.sha256((new / name).read_bytes()).hexdigest() == digest, name
    assert run('systemctl', 'show', 'test1-seo-preview', '-p', 'WorkingDirectory', '--value').strip() == str(new / 'web-next')
    run(NODE, str(new / 'infra/check-seo.mjs'), 'http://127.0.0.1:3001', 'https://jiutianxiaoshuo.com', '--sitemaps')
    backup = ROOT / 'backups' / ('seo-config-' + str(int(time.time())))
    backup.mkdir(mode=0o700)
    shutil.copy2(ENV, backup / 'web.env')
    shutil.copy2(NGINX, backup / 'nginx.conf')
    manifest['configurationBackup'] = str(backup)
    write(file, json.dumps(manifest, indent=2))
    nginx = NGINX.read_text()
    nginx, count = re.subn(r'^\s*add_header X-Robots-Tag "noindex, nofollow" always;\n', '\n', nginx, flags=re.M)
    assert count <= 1
    try:
        write(ENV, pathlib.Path(manifest['environmentFile']).read_bytes(), 0o600)
        ready(3001)
        route(nginx, 3001)
        print('TRAFFIC_ON_WARM_PREVIEW', flush=True)
        switch(new)
        run('systemctl', 'restart', 'test1-web')
        ready(3000)
        route(nginx, 3000)
        print('PENDING_PUBLIC_ACCEPTANCE ' + str(new), flush=True)
    except Exception:
        rollback(manifest)
        raise

if __name__ == '__main__':
    main()
