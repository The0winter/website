// Dedicated encrypted restic repository in the existing private R2 bucket.
// No pruning: a failed backup/check never replaces the last verified receipt.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {atomicWrite, readJson} from '../../tools/novel-crawler/storage.mjs';
import {workerLock} from './remote-worker.mjs';

export function resticEnvironment(env, {passwordFile = '/etc/test1-remote-worker/backup-password', cache = '/var/cache/test1-remote-worker-backup'} = {}) {
  if (!env.R2_BUCKET || env.R2_BUCKET === env.COVER_R2_BUCKET || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) throw Error('Private R2 configuration required');
  const endpoint = new URL(env.R2_ENDPOINT);
  if (endpoint.protocol !== 'https:' || !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname)) throw Error('Unexpected R2 endpoint');
  return {PATH: env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: '/root',
    RESTIC_REPOSITORY: `s3:${endpoint.origin}/${env.R2_BUCKET}/backups/codex-hybrid/restic`,
    RESTIC_PASSWORD_FILE: passwordFile, RESTIC_CACHE_DIR: cache,
    AWS_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    AWS_DEFAULT_REGION: 'auto', GOMAXPROCS: '1'};
}
function run(args, env, log) {
  return new Promise((resolve, reject) => {
    const output = fs.openSync(log, 'a', 0o600);
    const child = spawn('restic', ['-o', 's3.connections=2', ...args], {env, windowsHide: true, stdio: ['ignore', 'pipe', output]});
    let stdout = '';
    child.stdout.on('data', chunk => { fs.writeSync(output, chunk); stdout = (stdout + chunk).slice(-2 * 1024 * 1024); });
    child.once('error', error => { fs.closeSync(output); reject(error); });
    child.once('exit', code => { fs.closeSync(output); code === 0 ? resolve(stdout) : reject(Error(`Backup command failed (${code}); see private backup log`)); });
  });
}
export async function backupWorker({root = '/var/lib/test1-remote-worker', source = '/srv/test1-remote-worker/current', force = false, initialize = false, env = process.env} = {}) {
  const marker = path.join(root, 'backup-required.json'), receipt = path.join(root, 'backup-latest.json');
  if (!force && !fs.existsSync(marker)) return {idle: true};
  const unlock = workerLock(root);
  try {
  const generation = readJson(marker)?.generation;
  const environment = resticEnvironment(env);
  fs.mkdirSync(environment.RESTIC_CACHE_DIR, {recursive: true, mode: 0o700});
  const logs = '/var/log/test1-remote-worker'; fs.mkdirSync(logs, {recursive: true, mode: 0o700});
  const log = path.join(logs, 'backup.log');
  // Keep one bounded log. Restic owns immutable encrypted snapshot objects.
  fs.writeFileSync(log, '', {mode: 0o600});
  if (initialize) await run(['init', '--repository-version', '2'], environment, log);
  const codeRoot = fs.realpathSync(source);
  const output = await run(['backup', '--json', '--tag', 'test1-codex-hybrid',
    '--exclude', '**/node_modules', '--exclude', '**/.next', '--exclude', '**/.next-*',
    '--exclude', '**/.runtime/test-tmp', '--exclude', '**/.runtime/node-*',
    '--exclude', '**/.runtime/task-artifacts', '--exclude', '**/.runtime/storage-maintenance',
    '--exclude', '**/.git', '--exclude', '**/*.log', '--exclude', '**/worker.lock',
    codeRoot, root], environment, log);
  const summary = output.trim().split('\n').map(line => { try { return JSON.parse(line); } catch { return {}; } }).findLast(item => item.message_type === 'summary');
  if (!/^[a-f0-9]{8,64}$/.test(summary?.snapshot_id || '')) throw Error('Backup has no snapshot ID');
  await run(['check', '--read-data'], environment, log);
  const result = {status: 'verified', snapshot: summary.snapshot_id, verifiedAt: new Date().toISOString(),
    files: summary.total_files_processed, logicalBytes: summary.total_bytes_processed, addedBytes: summary.data_added,
    source: codeRoot, storage: 'private-r2', repositoryPrefix: 'backups/codex-hybrid/restic'};
  atomicWrite(receipt, result, {mode: 0o644});
  if (generation && readJson(marker)?.generation === generation) fs.unlinkSync(marker);
  return result;
  } finally { unlock(); }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--force', '--initialize'].includes(arg))) throw Error('Unknown backup option');
  console.log(JSON.stringify(await backupWorker({force: args.includes('--force'), initialize: args.includes('--initialize')})));
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(JSON.stringify({backupFailed: true, error: error.message})); process.exitCode = 1; });
