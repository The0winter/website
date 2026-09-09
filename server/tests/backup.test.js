import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runBackup} from '../../infra/backup.mjs';

test('failed or overlapping backups do not replace the last successful manifest',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'test1-backup-'));
  const config={directory,mongoConfig:path.join(directory,'secret.yaml'),mongodump:process.execPath,codeVersion:'synthetic',schemaVersion:'r3-v1'};
  const success=await runBackup(config,async(command,args)=>{assert.equal(args.some(a=>a.startsWith('--uri')),false);assert.ok(args.includes('--oplog'));await fs.writeFile(args.find(a=>a.startsWith('--archive=')).slice(10),'controlled-archive-bytes');});
  const before=await fs.readFile(path.join(directory,'latest.json'),'utf8');
  await assert.rejects(runBackup(config,async()=>{throw Object.assign(new Error('controlled low disk failure'),{code:'ENOSPC'});}));
  assert.equal(await fs.readFile(path.join(directory,'latest.json'),'utf8'),before);
  assert.equal(success.offsite,'not-verified');
  await fs.writeFile(path.join(directory,'backup.lock'),'held');
  await assert.rejects(runBackup(config,async()=>assert.fail('Concurrent dump must not start')),{code:'EEXIST'});
  // Fixture retained in OS temporary storage; never remove user backup directories.
});
