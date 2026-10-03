'use strict';
const fs = require('node:fs');
const path = require('node:path');
if (process.platform === 'win32' && fs.existsSync('D:/Apps/Codex/home/tools/windows-hide.cjs')) require('D:/Apps/Codex/home/tools/windows-hide.cjs');
require('../../tools/test-env.cjs');
const { spawn } = require('node:child_process');
const project = path.resolve(__dirname, '../..');
const sdk = process.env.ANDROID_HOME || 'D:/Apps/Android/sdk';
const avdHome = process.env.ANDROID_AVD_HOME || path.join(project, '.runtime/android-emulator');
const logDir = path.join(project, '.runtime/task-artifacts/android-v1');
fs.mkdirSync(avdHome, { recursive: true }); fs.mkdirSync(logDir, { recursive: true });
const gpu = process.env.JIUTIAN_GPU || 'swiftshader_indirect';
if (!['auto', 'host', 'software', 'swiftshader', 'swangle', 'lavapipe', 'swiftshader_indirect'].includes(gpu)) throw new Error('Unsupported JIUTIAN_GPU renderer');
function launchSpec(platform=process.platform,environment=process.env,extra=process.argv.slice(2)) {
  const launcher=path.join(sdk,'emulator');
  // Windows emulator.exe re-execs the native backend without propagating Node's
  // window flags. Launch that exact headless backend with its documented loader
  // environment instead; do not silently fall back to the window-opening wrapper.
  const executable=platform==='win32'?path.join(launcher,'qemu/windows-x86_64/qemu-system-x86_64-headless.exe'):path.join(launcher,'emulator');
  const childEnv={...environment,ANDROID_HOME:sdk,ANDROID_SDK_ROOT:sdk,ANDROID_AVD_HOME:avdHome};
  if(platform==='win32'){
    childEnv.ANDROID_EMULATOR_LAUNCHER_DIR=launcher;
    const pathKey=Object.keys(childEnv).find(key=>key.toLowerCase()==='path')||'PATH';
    const libraries=[path.join(launcher,'lib64'),path.join(launcher,'lib64',gpu.includes('angle')?'gles_angle':'gles_swiftshader'),path.join(launcher,'lib64/vulkan')];
    childEnv[pathKey]=[...libraries,childEnv[pathKey]||''].join(path.delimiter);
  }
  return {executable,args:['-avd',environment.JIUTIAN_AVD||'jiutian_api36',...extra,'-no-window','-no-audio','-no-boot-anim','-no-snapshot','-gpu',gpu,'-memory','2048'],options:{
    cwd:project,env:childEnv,detached:false,windowsHide:true,stdio:['ignore','pipe','pipe'],
  }};
}
function start(){
  const spec=launchSpec();
  if(!fs.existsSync(spec.executable))throw Error('Headless emulator backend missing; refusing to launch a console-producing fallback.');
  const log=fs.createWriteStream(path.join(logDir,'emulator-runtime.log'),{flags:'a'});
  // Keep this supervisor alive. Inherited file descriptors suppress libuv's
  // CREATE_NO_WINDOW flag; pipes plus windowsHide enable it. Detached processes
  // also defeat that guarantee on Windows, so neither detachment nor unref is used.
  const child=spawn(spec.executable,spec.args,spec.options);
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const status={supervisorPid:process.pid,pid:child.pid,gpu,avd:process.env.JIUTIAN_AVD||'jiutian_api36',startedAt:new Date().toISOString(),executable:spec.executable,noWindow:true,detached:false,stdio:'pipes'};
  const statusFile=path.join(logDir,'emulator-process.json');fs.writeFileSync(statusFile,JSON.stringify(status,null,2));
  child.on('error',error=>{log.end(String(error));console.error(error.message);process.exitCode=1});
  child.on('exit',(code,signal)=>{log.end();fs.writeFileSync(statusFile,JSON.stringify({...status,endedAt:new Date().toISOString(),code,signal},null,2));process.exitCode=code||0});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill());
  console.log(`Supervised headless emulator PID ${child.pid}; renderer ${gpu}; logs remain in ${logDir}`);
}
module.exports={launchSpec};
if(require.main===module)start();
