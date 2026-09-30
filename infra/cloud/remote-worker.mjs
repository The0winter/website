// A durable, serial queue around the existing crawler. No model or database access.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {acquire, validateSpec, jobId} from '../../tools/novel-crawler/core.mjs';
import {atomicWrite, readJson} from '../../tools/novel-crawler/storage.mjs';

const idPattern = /^[a-f0-9]{20}$/;
const date = () => new Date().toISOString();
function directory(root) {
  if (!path.isAbsolute(root)) throw Error('Absolute worker data directory required');
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  if (fs.lstatSync(root).isSymbolicLink()) throw Error('Linked worker data directory rejected');
  for (const name of ['queue', '.novel-crawler', 'downloads']) {
    const target = path.join(root, name);
    fs.mkdirSync(target, {recursive: true, mode: 0o700});
    if (fs.lstatSync(target).isSymbolicLink()) throw Error('Linked worker data rejected');
  }
  return root;
}
function jobFile(root, id) {
  if (!idPattern.test(id)) throw Error('Invalid job ID');
  const file = path.join(root, 'queue', id + '.json');
  if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) throw Error('Invalid queue file');
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Error('Linked queue file rejected');
  return file;
}
function writeJob(root, job) { atomicWrite(jobFile(root, job.id), {...job, updatedAt: date()}, {mode: 0o600}); }
export function queueJob(root, input, {mode = 'probe', batchSize = 50} = {}) {
  directory(root);
  if (!['probe', 'download'].includes(mode) || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw Error('Invalid job options');
  const spec = validateSpec(input);
  // Initial worker is HTTP/file-only. Interactive sources require a separate setup.
  if (JSON.stringify(spec).includes('"browser"') || spec.catalog?.selectPages) throw Error('Browser sources need a separately verified worker environment');
  const id = jobId(spec), file = jobFile(root, id);
  if (fs.existsSync(file)) throw Error('Job already exists; resume it explicitly');
  const job = {version: 1, id, spec, mode, batchSize, state: 'queued', createdAt: date(), crashes: 0};
  writeJob(root, job);
  return {id, title: spec.title, mode, state: job.state};
}
export function listJobs(root) {
  directory(root);
  return fs.readdirSync(path.join(root, 'queue')).filter(n => /^[a-f0-9]{20}\.json$/.test(n)).map(n => {
    const job = readJson(jobFile(root, n.slice(0, -5)));
    if (job?.version !== 1 || job.id !== n.slice(0, -5)) throw Error('Invalid saved job');
    return job;
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
function lock(root) {
  const file = path.join(root, 'worker.lock'), token = randomUUID();
  try { fs.writeFileSync(file, JSON.stringify({pid: process.pid, token}), {flag: 'wx', mode: 0o600}); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = readJson(file);
    if (!Number.isInteger(previous?.pid) || previous.pid < 1) throw Error('Invalid worker lock; preserve it for review');
    try { process.kill(previous.pid, 0); throw Error('Worker is already running'); }
    catch (ownerError) { if (ownerError.code !== 'ESRCH') throw ownerError; }
    if (readJson(file)?.token !== previous.token) throw Error('Worker lock changed');
    fs.unlinkSync(file);
    fs.writeFileSync(file, JSON.stringify({pid: process.pid, token}), {flag: 'wx', mode: 0o600});
  }
  return () => { if (readJson(file)?.token === token) fs.unlinkSync(file); };
}
export function classify(report, mode) {
  if (report.structuralPass && (mode === 'probe' || report.completeAgainstSource || report.completeSelectedScope)) return mode === 'probe' ? 'probed' : 'complete';
  if (mode === 'download' && report.structuralPass && !report.failures?.length && !report.paused && report.downloaded > 0 && report.missing?.length) return 'queued';
  return 'needs_attention';
}
export async function runNext(root, {collect = acquire, signal, enforceBackup = false} = {}) {
  directory(root);
  const unlock = lock(root);
  try {
    if (enforceBackup && fs.existsSync(path.join(root, 'backup-required.json'))) throw Error('Previous checkpoint still needs an offsite backup');
    const disk = fs.statfsSync(root);
    if (disk.bavail * disk.bsize < 8 * 1024 ** 3) throw Error('Less than 8 GiB free; preserve checkpoints and free reviewed build/cache output first');
    const job = listJobs(root).find(j => ['queued', 'running'].includes(j.state));
    if (!job) return {idle: true};
    if (job.state === 'running' && ++job.crashes > 2) {
      job.state = 'needs_attention'; job.message = 'Repeated process interruption; checkpoints preserved';
      writeJob(root, job); return {id: job.id, state: job.state};
    }
    job.state = 'running'; job.startedAt = date(); writeJob(root, job);
    const backupGeneration = randomUUID();
    atomicWrite(path.join(root, 'backup-required.json'), {id: job.id, generation: backupGeneration, at: date()}, {mode: 0o600});
    try {
      let lastProgress = 0;
      const report = await collect(job.spec, {mode: job.mode, stateDir: path.join(root, '.novel-crawler'), outputDir: path.join(root, 'downloads'),
        maxNew: job.mode === 'download' ? job.batchSize : undefined, samples: 4, publisherCategories: true, stopOnFailure: true, signal,
        onProgress: progress => { if (Date.now() - lastProgress > 30000) { lastProgress = Date.now(); job.progress = progress; writeJob(root, job); } }});
      job.state = signal?.aborted ? 'queued' : classify(report, job.mode);
      job.report = {downloaded: report.downloaded, expected: report.expected, structuralPass: report.structuralPass,
        completeAgainstSource: report.completeAgainstSource, completeSelectedScope: report.completeSelectedScope,
        exportFile: report.exportFile, missingCount: report.missing?.length || 0,
        issues: (report.issues || []).slice(0, 15), failures: (report.failures || []).slice(0, 5)};
      job.finishedAt = date(); delete job.progress;
    } catch (error) {
      job.state = signal?.aborted ? 'queued' : 'needs_attention'; job.message = String(error.message).slice(0, 500);
    }
    writeJob(root, job);
    const result = {id: job.id, title: job.spec.title, source: job.spec.sourceUrl, state: job.state, report: job.report, message: job.message};
    atomicWrite(path.join(root, 'last-run.json'), {...result, at: date()}, {mode: 0o600});
    return result;
  } finally { unlock(); }
}
export function resumeJob(root, id, {mode} = {}) {
  directory(root); const unlock = lock(root);
  try {
    const job = readJson(jobFile(root, id));
    if (!job) throw Error('Job not found');
    if (mode && !['probe', 'download'].includes(mode)) throw Error('Invalid mode');
    job.state = 'queued'; job.crashes = 0; if (mode) job.mode = mode; delete job.message;
    writeJob(root, job); return {id, state: job.state, mode: job.mode};
  } finally { unlock(); }
}
async function main() {
  const {positionals, values} = parseArgs({allowPositionals: true, options: {root: {type: 'string'}, spec: {type: 'string'}, id: {type: 'string'}, mode: {type: 'string'}, 'batch-size': {type: 'string'}, 'require-backup': {type: 'boolean'}}});
  const root = values.root || '/var/lib/test1-remote-worker';
  let result;
  if (positionals[0] === 'enqueue') result = queueJob(root, readJson(values.spec), {mode: values.mode || 'probe', batchSize: Number(values['batch-size'] || 50)});
  else if (positionals[0] === 'resume') result = resumeJob(root, values.id, {mode: values.mode});
  else if (positionals[0] === 'status') result = listJobs(root).map(j => ({id: j.id, title: j.spec.title, state: j.state, mode: j.mode, report: j.report, message: j.message}));
  else if (positionals[0] === 'run-next') {
    const controller = new AbortController();
    for (const name of ['SIGTERM', 'SIGINT']) process.once(name, () => controller.abort());
    result = await runNext(root, {signal: controller.signal, enforceBackup: values['require-backup']});
  } else throw Error('Expected enqueue, resume, status or run-next');
  console.log(JSON.stringify(result));
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(JSON.stringify({error: error.message})); process.exitCode = 1; });
