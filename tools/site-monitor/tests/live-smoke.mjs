// Explicit read-only integration check, never included in the automatic unit suite.
import '../../test-env.cjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launch} from '../main.mjs';
import {projectRoot} from '../server.mjs';
import {workspace,removeWorkspace} from './fixture.mjs';
const root=workspace(),directory=path.join(projectRoot,'.runtime/task-artifacts/site-monitor-v3');
fs.mkdirSync(directory,{recursive:true});
let running;
try {
  running=await launch({root,headless:true});
  const {app,page,profile}=running;
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const deadline=Date.now()+70000;
  while(Object.values(app.snapshot().modules).some(x=>!x.lastSuccess)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,1000));
  const first=app.snapshot();for(const [name,value]of Object.entries(first.modules))assert.ok(value.lastSuccess,`${name}: ${value.error}`);
  await page.waitForSelector('#content .resource-grid',{timeout:15000});
  await app.session.refresh('server');
  if(process.argv.includes('--inventory')){
    await fetch(app.baseUrl+'/api/inventory',{method:'POST',headers:{'x-monitor-token':app.token},body:'{}'});
    const until=Date.now()+360000;let reportAt=Date.now();while(app.snapshot().inventory.running&&Date.now()<until){await new Promise(r=>setTimeout(r,1000));if(Date.now()-reportAt>30000){console.log(JSON.stringify({inventoryProgress:app.snapshot().inventory.buckets.map(({id,objects,pages,complete})=>({id,objects,pages,complete}))}));reportAt=Date.now();}}
    assert.equal(app.snapshot().inventory.running,false,'Inventory timed out');
    assert.ok(app.snapshot().inventory.buckets.every(x=>x.complete),'Inventory did not complete');
  }
  await new Promise(r=>setTimeout(r,2300));
  await page.screenshot({path:path.join(directory,'final-live-overview.png'),fullPage:true});
  await page.locator('.nav-item[data-page="resources"]').click();assert.equal(await page.$eval('#page-title',e=>e.textContent),'还有多少余量');await page.screenshot({path:path.join(directory,'final-live-server.png'),fullPage:true});
  await page.locator('.nav-item[data-page="audience"]').click();await page.waitForSelector('.range-strip');assert.equal(await page.$eval('#page-title',e=>e.textContent),'访问来源与热门内容');await page.screenshot({path:path.join(directory,'final-live-audience.png'),fullPage:true});
  await page.locator('.nav-item[data-page="storage"]').click();assert.equal(await page.$eval('#page-title',e=>e.textContent),'小说和封面是否可用');await page.screenshot({path:path.join(directory,'final-live-r2.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  const state=app.snapshot(),summary={verifiedAt:new Date().toISOString(),modules:Object.fromEntries(Object.entries(state.modules).map(([k,v])=>[k,{status:v.data?.status||v.status,points:v.history.length}])),checks:state.modules.site.data.checks,business:{totalUsers:state.modules.business.data.totalUsers,reads:state.modules.business.data.current.reads,excludedBaseline:state.modules.business.data.excludedBaseline},atlasBytes:state.modules.atlas.data.cluster?.logicalBytes,r2:state.inventory.buckets.map(({id,bytes,objects,complete})=>({id,bytes,objects,complete}))};
  assert.ok(summary.checks.every(c=>c.status==='ok'),'Public reading probe did not pass');
  await page.close();
  for(let i=0;i<100&&fs.existsSync(path.join(root,'.runtime/site-monitor/instance.json'));i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(fs.existsSync(path.join(root,'.runtime/site-monitor/instance.json')),false,'App instance still running');
  assert.equal(fs.existsSync(profile),false,'Browser profile not cleaned');
  await assert.rejects(fetch(app.baseUrl+'/api/state',{signal:AbortSignal.timeout(2000)}));
  summary.closeStopsApp=true;summary.profileRemoved=true;
  fs.writeFileSync(path.join(directory,'verified-live-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{await running?.close();removeWorkspace(root);}
