// Explicit Windows integration check of the actual shortcut target and default root.
// Uses the production launcher in headless mode, with no dialogs or persistent test data.
import '../../test-env.cjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import puppeteer from 'puppeteer';
import {projectRoot} from '../server.mjs';

if(process.platform!=='win32')throw Error('Windows launcher check requires Windows');
const state=path.join(projectRoot,'.runtime/site-monitor');
const instanceFile=path.join(state,'instance.json');
const artifacts=path.join(projectRoot,'.runtime/task-artifacts/site-monitor-startup');
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(fs.existsSync(instanceFile)&&alive(read(instanceFile).pid))throw Error('Monitor is already running; leave its window untouched');
fs.mkdirSync(artifacts,{recursive:true});
const errorLog=path.join(state,'last-launch.error.log');
if(fs.existsSync(errorLog)&&fs.statSync(errorLog).size)fs.copyFileSync(errorLog,path.join(artifacts,'debug-previous-launch-error.log'));
let browser,profile,pid;
try {
  const trigger=spawn('wscript.exe',[path.join(projectRoot,'tools/site-monitor/launch.vbs')],{cwd:projectRoot,windowsHide:true,stdio:'ignore',env:{...process.env,SITE_MONITOR_HEADLESS:'1',SITE_MONITOR_NO_DIALOG:'1'}});
  const [code]=await once(trigger,'exit');assert.equal(code,0);
  const deadline=Date.now()+40000;
  while(!browser&&Date.now()<deadline){
    if(fs.existsSync(instanceFile)){
      pid=read(instanceFile).pid;
      const base=path.join(state,'browser');
      if(fs.existsSync(base))for(const entry of fs.readdirSync(base,{withFileTypes:true})){
        if(!entry.isDirectory())continue;
        const candidate=path.join(base,entry.name),owner=path.join(candidate,'owner.json'),portFile=path.join(candidate,'profile/DevToolsActivePort');
        if(!fs.existsSync(owner)||read(owner).pid!==pid||!fs.existsSync(portFile))continue;
        const port=Number(fs.readFileSync(portFile,'utf8').split('\n')[0]);
        if(Number.isInteger(port)&&port>0){profile=candidate;browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${port}`});break;}
      }
    }
    if(!browser)await delay(200);
  }
  assert.ok(browser,'Default shortcut launcher did not start a browser');
  const page=(await browser.pages()).find(p=>p.url().startsWith('http://127.0.0.1:'));assert.ok(page,'Local monitor page missing');
  await page.waitForSelector('#page-title');
  await page.waitForFunction(()=>document.querySelector('#content .resource-grid')!==null,{timeout:30000});
  const states=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{page.off('response',onResponse);reject(Error('Live sources did not become ready'));},70000);
    async function onResponse(response){
      if(!response.url().endsWith('/api/state'))return;
      try {const value=await response.json();if(['server','atlas','r2','site'].every(k=>value.modules?.[k]?.lastSuccess)){clearTimeout(timer);page.off('response',onResponse);resolve(value);}}catch{}
    }
    page.on('response',onResponse);
  });
  const snapshot=await states;
  await page.screenshot({path:path.join(artifacts,'verified-default-launch.png'),fullPage:true});
  const summary={verifiedAt:new Date().toISOString(),launcher:'launch.vbs → launch.ps1 → bundled Node → main.mjs',defaultRoot:projectRoot,modules:Object.fromEntries(Object.entries(snapshot.modules).map(([k,v])=>[k,v.status]))};
  await page.close();
  for(let i=0;i<100&&(fs.existsSync(instanceFile)||alive(pid));i++)await delay(100);
  assert.equal(alive(pid),false,'Node survived window close');assert.equal(fs.existsSync(instanceFile),false);assert.equal(fs.existsSync(profile),false);
  assert.equal(fs.readFileSync(errorLog,'utf8').trim(),'');
  summary.closeStopsProcess=true;summary.profileRemoved=true;summary.launchErrorLogEmpty=true;
  fs.writeFileSync(path.join(artifacts,'verified-launcher.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{if(browser?.connected)await browser.close();}
