"""Invoked over SSH as root; credentials never leave the VPS."""
import os
import pathlib
import subprocess
import sys
import tempfile

if os.geteuid() != 0 or sys.argv[1:] not in ([], ['--apply']):
    raise SystemExit('Run through the supported SSH import command.')
env = os.environ.copy()
for line in pathlib.Path('/etc/test1/api.env').read_text().splitlines():
    key, separator, value = line.partition('=')
    if separator and key == 'IMPORT_SECRET':
        env[key] = value
env['IMPORT_API_URL'] = 'http://127.0.0.1:5000/api'
with tempfile.TemporaryDirectory(prefix='test1-import-') as directory:
    target = pathlib.Path(directory) / 'book.json'
    with target.open('wb') as output:
        os.chmod(target, 0o600)
        size = 0
        while chunk := sys.stdin.buffer.read(1024 * 1024):
            size += len(chunk)
            if size > 512 * 1024 * 1024:
                raise SystemExit('JSON exceeds 512 MiB limit.')
            output.write(chunk)
    result = subprocess.run(['/opt/node-v22.23.2-linux-x64/bin/node',
        '/srv/test1/current/infra/import-local.mjs', str(target), *sys.argv[1:]], env=env)
    raise SystemExit(result.returncode)
