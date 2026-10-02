#!/usr/bin/env python3
"""Poll this project's public main branch and prepare a compatible release.

Planning is the default. --apply is for the separately approved systemd service.
No credentials, database migrations, infrastructure installation or self-updates.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import urllib.request

ROOT = Path('/srv/test1')
STATE = Path('/var/lib/test1-auto-deploy')
REPOSITORY = Path('/var/cache/test1-auto-deploy/repository.git')
ORIGIN = 'https://github.com/The0winter/website.git'
SITE = 'https://jiutianxiaoshuo.com'
NODE = '/opt/node-v22.23.2-linux-x64/bin/node'
LOCK = Path('/run/lock/test1-release-deployment.lock')
VERSION_FILE = 'web-next/public/deployment-version.json'
PROTECTED = {
    'server/package.json', 'server/package-lock.json', 'server/config.js',
    'server/migrate_passwords.js', 'server/services/identity-migration.js',
    'web-next/package.json', 'web-next/package-lock.json', 'web-next/next.config.ts',
    'web-next/tsconfig.json',
    VERSION_FILE,
}
IGNORED_PREFIXES = ('web-next/tests/', 'web-next/artifacts/', 'server/tests/', 'server/fixtures/')


class DeploymentError(RuntimeError):
    pass


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def write_json(file, value):
    temporary = file.with_suffix(file.suffix + '.next')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temporary.replace(file)


def run(*arguments, cwd=None, env=None, timeout=180, log=None, allow_failure=False, umask=None):
    options = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
    if umask is not None:
        options['umask'] = umask
    result = subprocess.run(arguments, cwd=cwd, env=env, capture_output=True, timeout=timeout, **options)
    if log:
        with log.open('ab') as output:
            output.write(result.stdout + result.stderr)
    if result.returncode and not allow_failure:
        # Subprocess output stays in the root-only build log; never emit env or credentials.
        raise DeploymentError(f'{Path(arguments[0]).name} failed with exit {result.returncode}')
    return result


def git(*arguments, allow_failure=False):
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith('GIT_')}
    environment.update(GIT_TERMINAL_PROMPT='0', GIT_CONFIG_GLOBAL='/dev/null',
                       GIT_CONFIG_NOSYSTEM='1')
    return run('git', '-c', 'credential.helper=', '-c', 'core.askpass=',
               '-c', 'core.hooksPath=/dev/null', '-c', 'http.sslVerify=true',
               '--git-dir=' + str(REPOSITORY), *arguments, env=environment,
               allow_failure=allow_failure)


def fetch_main():
    if not REPOSITORY.exists():
        REPOSITORY.parent.mkdir(parents=True, exist_ok=True)
        git('init', '--bare', str(REPOSITORY))
        git('remote', 'add', 'origin', ORIGIN)
        git('config', 'remote.origin.promisor', 'true')
        git('config', 'remote.origin.partialclonefilter', 'blob:none')
    if git('remote', 'get-url', 'origin').stdout.decode().strip() != ORIGIN:
        raise DeploymentError('Repository origin changed')
    git('fetch', '--filter=blob:none', 'origin', 'refs/heads/main')
    sha = git('rev-parse', 'FETCH_HEAD').stdout.decode().strip()
    if not re.fullmatch('[a-f0-9]{40}', sha):
        raise DeploymentError('Invalid main commit')
    return sha


def runtime_path(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name:
        raise DeploymentError('Unsafe repository path')
    if not name.startswith(('web-next/', 'server/', 'shared/')):
        return False
    if name.startswith(IGNORED_PREFIXES):
        return False
    if (name in PROTECTED or name.startswith(('server/migrations/', 'server/database/'))
            or any(part.startswith('.env') or part in ('node_modules', '.git') for part in path.parts)
            or any(part.startswith('.next') for part in path.parts)
            or path.suffix.lower() in ('.pem', '.key', '.p12', '.pfx')):
        raise DeploymentError('Protected dependency, configuration or migration change: ' + name)
    return True


def safe_target(directory, name):
    path = directory / name
    if not path.resolve().is_relative_to(directory.resolve()):
        raise DeploymentError('Path leaves release directory: ' + name)
    if any(item.is_symlink() for item in [path, *path.parents] if item != directory.parent):
        raise DeploymentError('Symlink in changed source path: ' + name)
    return path


def comparable(data, name):
    if PurePosixPath(name).suffix.lower() in ('.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.json', '.svg', '.txt', '.md'):
        return data.replace(b'\r\n', b'\n')
    return data


def verify_baseline(directory, name, before):
    file = safe_target(directory, name)
    actual = file.read_bytes() if file.is_file() else None
    if before is None:
        if file.exists():
            raise DeploymentError('New file already exists online: ' + name)
    elif actual is None or comparable(actual, name) != comparable(before, name):
        raise DeploymentError('Online source differs from committed baseline: ' + name)


def blob(commit, name):
    entry = git('ls-tree', commit, '--', name).stdout.decode().strip()
    if not entry:
        return None
    if entry.split()[0] not in ('100644', '100755') or entry.split()[1] != 'blob':
        raise DeploymentError('Only regular source files can be deployed: ' + name)
    return git('show', commit + ':' + name).stdout


def plan(old, base, head):
    if git('merge-base', '--is-ancestor', base, head, allow_failure=True).returncode:
        raise DeploymentError('Main is not a descendant of the active source commit')
    names = git('diff', '--name-only', '--no-renames', '-z', base, head).stdout.decode().split('\0')
    changes = []
    for name in filter(None, names):
        if not runtime_path(name):
            continue
        before, after = blob(base, name), blob(head, name)
        verify_baseline(old, name, before)
        changes.append((name, after))
    return changes


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def source_hashes(directory):
    result = {}
    for folder in ('server', 'shared', 'infra', 'web-next'):
        for file in (directory / folder).rglob('*'):
            if (file.is_file() and not file.is_symlink()
                    and not any(part == 'node_modules' or part == '__pycache__' or part.startswith('.next') for part in file.parts)
                    and not file.name.startswith('.env')
                    and file.name not in ('tsconfig.tsbuildinfo', 'next-env.d.ts')):
                result[file.relative_to(directory).as_posix()] = digest(file)
    return result


def service_env(service):
    pid = run('systemctl', 'show', service, '-p', 'MainPID', '--value').stdout.decode().strip()
    values = dict(item.split('=', 1) for item in Path('/proc', pid, 'environ').read_text().split('\0') if '=' in item)
    values['PATH'] = str(Path(NODE).parent) + ':' + os.environ.get('PATH', '')
    values['NEXT_TELEMETRY_DISABLED'] = '1'
    return values


def read(url):
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'Test1DeploymentHealth/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def health():
    if not json.loads(read('http://127.0.0.1:5000/health/ready')).get('ready'):
        raise DeploymentError('API is not ready')
    run('systemctl', 'is-active', '--quiet', 'test1-api', 'test1-web')


def verify_site(base, head):
    if json.loads(read(base + '/deployment-version.json?commit=' + head)).get('sourceCommit') != head:
        raise DeploymentError('Served build does not match requested commit')
    if b'book-search-field' not in read(base + '/'):
        raise DeploymentError('Homepage did not render')
    books = json.loads(read(base + '/api/books?limit=20'))
    for book in books:
        chapters = json.loads(read(base + '/api/books/' + book['id'] + '/chapters?limit=1'))
        if chapters:
            chapter_id = chapters[0]['id']
            content = json.loads(read(base + '/api/chapters/' + chapter_id))
            if len(content.get('content', '')) <= 100:
                raise DeploymentError('Chapter content is incomplete')
            detail = read(base + '/book/' + book['id'])
            catalog = json.loads(read(base + '/api/books/' + book['id'] + '/catalog?anchor=' + chapter_id + '&limit=128'))
            if b'book-detail' not in detail or not any(row['id'] == chapter_id for row in catalog['rows']):
                raise DeploymentError('Book detail or catalog unavailable')
            if b'reader-pages-root' not in read(base + '/book/' + book['id'] + '/' + chapter_id):
                raise DeploymentError('Reader did not render')
            return {'bookId': book['id'], 'chapterId': chapter_id, 'chapterLength': len(content['content'])}
    raise DeploymentError('No readable chapter available for acceptance')


def activate_transaction(activate, validate, accept, rollback):
    """Acceptance is recorded only after public validation; all earlier failures roll back."""
    try:
        activate()
        result = validate()
        accept(result)
        return result
    except Exception:
        rollback()
        raise


def deploy(old, head, changes, report):
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
    new = ROOT / 'releases' / ('auto-' + head[:12] + '-' + stamp)
    if new.exists() or shutil.disk_usage(ROOT).free < 2 * 1024 ** 3:
        raise DeploymentError('Release already exists or insufficient disk space')
    if run('systemctl', 'is-active', '--quiet', 'test1-seo-preview', allow_failure=True).returncode == 0:
        raise DeploymentError('Another release has a preview in progress')
    baseline = source_hashes(old)
    shutil.copytree(old, new, symlinks=True, ignore=shutil.ignore_patterns('node_modules', '.next*', '.git', '.runtime', '__pycache__', '.env', '.env.*'))
    for folder in ('node_modules', 'server/node_modules', 'web-next/node_modules'):
        if (old / folder).exists():
            run('cp', '-al', str(old / folder), str(new / folder))
    for name, content in changes:
        file = safe_target(new, name)
        if content is None:
            file.unlink()
        else:
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(content)
            file.chmod(0o644)
    version = new / VERSION_FILE
    version.parent.mkdir(parents=True, exist_ok=True)
    write_json(version, {'sourceCommit': head, 'preparedAt': now()})
    version.chmod(0o644)
    expected = source_hashes(new)
    manifest = {'sourceCommit': head, 'release': str(new), 'previousRelease': str(old),
                'preparedAt': now(), 'automatic': True,
                'files': [{'path': name, 'sha256': expected.get(name), 'deleted': content is None} for name, content in changes]}
    write_json(new / 'deployment-manifest.json', manifest)
    report.update(state='building', release=str(new))
    write_json(STATE / 'last-run.json', report)
    log = STATE / 'last-build.log'
    log.write_bytes(b'')
    # Dependency manifests are protected; shared dependency files remain immutable.
    # Build hooks run as the existing unprivileged web account, never as root.
    import pwd
    account = pwd.getpwnam('test1-web')
    os.chown(new / 'web-next', account.pw_uid, account.pw_gid)
    generated_types = new / 'web-next/next-env.d.ts'
    if generated_types.exists():
        os.chown(generated_types, account.pw_uid, account.pw_gid)
    run('runuser', '-u', 'test1-web', '--', str(Path(NODE).parent / 'npm'), 'run', 'build',
        cwd=new / 'web-next', env=service_env('test1-web'), timeout=900, log=log, umask=0o022)
    for name, content in changes:
        if content is not None and name.startswith(('server/', 'shared/')) and name.endswith(('.js', '.mjs', '.cjs')):
            run(NODE, '--check', str(new / name), log=log)
    if source_hashes(old) != baseline or source_hashes(new) != expected:
        raise DeploymentError('Source changed during build')
    if (ROOT / 'current').resolve() != old:
        raise DeploymentError('Active release changed during build')
    if run('ss', '-ltnH', 'sport = :3001').stdout.strip():
        raise DeploymentError('Preview port is occupied')
    run('systemd-run', '--unit=test1-seo-preview', '--collect',
        '--property=User=test1-web', '--property=Group=test1-web',
        '--property=WorkingDirectory=' + str(new / 'web-next'),
        '--property=EnvironmentFile=/etc/test1/web.env', '--property=Environment=NODE_ENV=production',
        '--property=NoNewPrivileges=true', '--property=PrivateTmp=true',
        '--property=ProtectSystem=strict', '--property=ProtectHome=true',
        '--property=ReadWritePaths=' + str(new / 'web-next/.next-candidate/cache'),
        '--property=MemoryMax=1024M', NODE, '--max-old-space-size=640',
        str(new / 'web-next/node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3001')
    spec = importlib.util.spec_from_file_location('activation', old / 'infra/activate-web-release.py')
    activation = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(activation)
    switched = False
    nginx = activation.NGINX.read_text()
    try:
        activation.ready(3001)
        verify_site('http://127.0.0.1:3001', head)
        health()
        backup = ROOT / 'backups' / new.name
        backup.mkdir(mode=0o700)
        shutil.copy2(activation.NGINX, backup / 'nginx.conf')
        manifest['configurationBackup'] = str(backup)
        write_json(new / 'deployment-manifest.json', manifest)

        def activate():
            nonlocal switched
            report['state'] = 'activating'
            write_json(STATE / 'last-run.json', report)
            activation.route(nginx, 3001)
            activation.switch(new)
            switched = True
            run('systemctl', 'restart', 'test1-api', 'test1-web')
            activation.ready(3000)
            health()
            activation.route(nginx, 3000)

        def accept(result):
            manifest.update(activatedAt=now(), acceptance={'public': result, 'health': 'ready'})
            write_json(new / 'deployment-manifest.json', manifest)

        def rollback():
            if switched:
                activation.switch(old)
                run('systemctl', 'restart', 'test1-api', 'test1-web')
                activation.ready(3000)
                health()
            activation.write(activation.NGINX, nginx)
            run('nginx', '-t')
            run('systemctl', 'reload', 'nginx')
            manifest.pop('activatedAt', None)
            manifest['failedAt'] = now()
            write_json(new / 'deployment-manifest.json', manifest)

        activate_transaction(activate, lambda: verify_site(SITE, head), accept, rollback)
    finally:
        run('systemctl', 'stop', 'test1-seo-preview', allow_failure=True)
    # Retention failure must not undo a healthy accepted release.
    retention = run('systemctl', 'start', 'test1-release-prune.service', timeout=240, allow_failure=True)
    return {'release': str(new), 'activatedAt': manifest['activatedAt'], 'retentionExit': retention.returncode}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--retry', action='store_true', help='Retry a previously failed main SHA after operator review')
    args = parser.parse_args()
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise DeploymentError('Run on the approved VPS service account (root)')
    import fcntl
    with LOCK.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'state': 'busy'}))
            return
        STATE.mkdir(parents=True, exist_ok=True)
        old = (ROOT / 'current').resolve(strict=True)
        prior = json.loads((old / 'deployment-manifest.json').read_text())
        if old.parent != ROOT / 'releases' or not prior.get('activatedAt'):
            raise DeploymentError('Active release is not accepted; leave it untouched')
        head = fetch_main()
        if head == prior['sourceCommit']:
            print(json.dumps({'state': 'current', 'sourceCommit': head}))
            return
        last = STATE / 'last-run.json'
        previous = json.loads(last.read_text()) if last.exists() else {}
        if previous.get('state') == 'failed' and previous.get('sourceCommit') == head and not args.retry:
            print(json.dumps({'state': 'failed-commit-held', 'sourceCommit': head}))
            return
        report = {'sourceCommit': head, 'previousRelease': str(old), 'startedAt': now(), 'state': 'checking'}
        try:
            changes = plan(old, prior['sourceCommit'], head)
            report['files'] = [name for name, _ in changes]
            if not args.apply:
                print(json.dumps({**report, 'state': 'plan'}, ensure_ascii=False))
                return
            write_json(last, report)
            result = deploy(old, head, changes, report)
            report.update(result, state='accepted', finishedAt=now())
        except Exception as error:
            report.update(state='failed', finishedAt=now(), error=str(error))
            if args.apply:
                write_json(last, report)
            raise
        write_json(last, report)
        print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Automatic deployment stopped: ' + str(error), file=sys.stderr)
        sys.exit(1)
