const path = require('node:path');
const {spawn} = require('node:child_process');
const {activity, queueAutomatic} = require('./storage-maintenance.cjs');
const root = path.resolve(__dirname, '..');
const [kind, ...args] = process.argv.slice(2);
const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const commands = {web: [npm, '--prefix', 'web-next', 'run', args[0], ...(args.length > 1 ? ['--', ...args.slice(1)] : [])],
  'server-test': [npm, '--prefix', 'server', 'test', ...args], node: args};
if (!commands[kind]?.length) throw Error('Expected web, server-test or node command');
const release = activity(kind === 'web' ? ['build', 'clean-room', 'artifacts'] : ['temp', 'build', 'clean-room', 'artifacts', 'crawler-cache'], {sweep: true});
const child = spawn(process.execPath, commands[kind], {cwd: root, env: process.env, windowsHide: true, stdio: 'inherit'});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('error', error => { release(); console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => { release(); queueAutomatic(); process.exitCode = code ?? (signal ? 1 : 0); });
