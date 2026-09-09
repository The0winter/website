import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
const directory=path.resolve('.runtime/monitor-candidate-'+Date.now());await fs.mkdir(directory,{recursive:true});
process.env.MONITOR_SECRET=crypto.randomBytes(32).toString('hex');
const config=readConfig({APP_ENV:'test',MONGO_URI:'mongodb://127.0.0.1:1/test1_test',JWT_SECRET:crypto.randomBytes(48).toString('hex'),EXTERNAL_SERVICES:'disabled'});
// Deliberately do not connect: real application readiness is 503 and liveness remains 200.
const api=createApp(config).listen(0,'127.0.0.1');await new Promise(resolve=>api.once('listening',resolve));
const settings={apiUrl:`http://127.0.0.1:${api.address().port}`,secret:process.env.MONITOR_SECRET,stateFile:path.join(directory,'state.json'),backupManifest:path.join(directory,'missing-backup.json'),diskPath:directory};
await fs.writeFile(path.join(directory,'monitor.json'),JSON.stringify(settings),{mode:0o600});
// Controlled persisted outage start exercises CLI state loading; elapsed threshold has separate clock tests.
await fs.writeFile(settings.stateFile,JSON.stringify({unavailableSince:Date.now()-61000,alerts:[]}));
try{
  let output='';const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['infra/monitor.mjs',path.join(directory,'monitor.json')],{windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',data=>output+=data);child.stderr.on('data',()=>{});child.on('error',reject);child.on('exit',resolve);});
  assert.equal(code,0);const sample=JSON.parse(output);
  assert.ok(sample.alerts.includes('service-unavailable'));assert.ok(sample.alerts.includes('backup-stale'));assert.equal(sample.alerts.includes('metrics-unavailable'),false);assert.equal(sample.delivery,'local-journal-only');assert.equal(sample.metrics.databaseReady,false);
  assert.equal(output.includes(settings.secret),false);
  await fs.writeFile('artifacts/monitor-candidate-report.json',JSON.stringify({result:'passed',alerts:sample.alerts,delivery:sample.delivery,metricKeys:Object.keys(sample.metrics),limitations:'Synthetic persisted outage age; no external notification channel or systemd timer installed'},null,2));
  console.log('LOCAL_MONITOR_CAPTURE_PASSED');
}finally{await new Promise(resolve=>api.close(resolve));delete process.env.MONITOR_SECRET;}
