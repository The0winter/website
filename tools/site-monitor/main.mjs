import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer';
import {fileURLToPath} from 'node:url';
import {createMonitor,projectRoot} from './server.mjs';
import retention from '../storage-maintenance.cjs';
import storage from './storage-policy.cjs';

export async function launch({headless=process.env.SITE_MONITOR_HEADLESS==='1',onReady,root=projectRoot}={}) {
  root=path.resolve(root);
  const stateDir=retention.inside(root,storage.BASE);fs.mkdirSync(stateDir,{recursive:true});
  const lock=retention.inside(root,storage.BASE+'/instance.json');
  const active=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
  try{fs.writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx'});}catch(error){
    if(error.code!=='EEXIST')throw error;
    let old;try{old=JSON.parse(fs.readFileSync(lock,'utf8'));}catch{throw Error('启动锁异常，请检查 .runtime/site-monitor/instance.json');}
    if(!Number.isInteger(old.pid)||active(old.pid))return {alreadyRunning:true};
    fs.unlinkSync(lock);fs.writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx'});
  }
  let browser,app,closed=false;
  const relative=storage.BASE+'/browser/session-'+crypto.randomUUID();
  const profile=retention.inside(root,relative);
  const owner={app:'site-monitor',pid:process.pid,closed:false};
  const writeOwner=()=>fs.writeFileSync(retention.inside(root,relative+'/owner.json'),JSON.stringify(owner));
  const clean=()=>{try{return retention.maintain({root,scope:'site-monitor',apply:true,processes:[]});}catch{return null;}};
  async function close(){
    if(closed)return;closed=true;
    await app?.close();
    try{if(browser?.connected)await browser.close();}catch{browser?.process()?.kill();}
    owner.closed=true;if(fs.existsSync(profile))writeOwner();clean();
    try{if(JSON.parse(fs.readFileSync(lock,'utf8')).pid===process.pid)fs.unlinkSync(lock);}catch{}
    process.off('SIGINT',close);process.off('SIGTERM',close);
  }
  try{
    clean();
    if(storage.browserBytes(root)>=storage.POLICY.browserBytes)throw Error('监控浏览器临时目录已达 256 MiB，请关闭残留窗口后运行 npm run monitor:clean。受保护文件不会自动删除。');
    fs.mkdirSync(profile,{recursive:true});writeOwner();
    const executablePath=[process.env.SITE_MONITOR_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p=>fs.existsSync(p));
    if(!executablePath)throw Error('未找到 Chrome 或 Edge，请先安装浏览器。');
    app=await createMonitor({root,onClose:close});
    browser=await puppeteer.launch({executablePath,headless,userDataDir:path.join(profile,'profile'),defaultViewport:headless?{width:1440,height:1000}:null,args:[`--app=${app.url}`,'--window-size=1400,950','--no-default-browser-check','--disable-background-networking','--disable-background-mode','--disk-cache-size=8388608','--media-cache-size=1048576','--disable-application-cache']});
    owner.browserPid=browser.process()?.pid;writeOwner();
    let page=(await browser.pages()).find(p=>p.url().startsWith(app.baseUrl));if(!page){page=(await browser.pages())[0]||await browser.newPage();await page.goto(app.url);}
    const cdp=await page.createCDPSession();await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.detach();
    browser.on('disconnected',()=>void close());page.on('close',()=>void close());
    process.on('SIGINT',close);process.on('SIGTERM',close);
    await onReady?.({app,browser,page,close,profile});
    return {app,browser,page,close,profile};
  }catch(error){await close();throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))launch().catch(error=>{console.error(error.message);process.exitCode=1;});
