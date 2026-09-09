import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

async function dump(command,args) {
  await new Promise((resolve,reject)=>{
    const child=spawn(command,args,{windowsHide:true,stdio:'ignore'});
    const timer=setTimeout(()=>child.kill('SIGTERM'),90*60000);
    child.once('error',()=>{clearTimeout(timer);reject(new Error('Backup tool could not start'));});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`Backup tool failed (${code})`));});
  });
}

export async function runBackup(config, execute=dump) {
  for(const key of ['directory','mongoConfig','mongodump'])if(typeof config[key]!=='string'||!path.isAbsolute(config[key]))throw new Error(`Absolute ${key} required`);
  if(!config.codeVersion||!config.schemaVersion)throw new Error('Code/schema versions required');
  const created=await fs.mkdir(config.directory,{recursive:true,mode:0o750});
  if(created)await fs.chmod(config.directory,0o750);
  const lockPath=path.join(config.directory,'backup.lock');
  const lock=await fs.open(lockPath,'wx',0o600);
  const previousMask=process.umask(0o077);
  const startedAt=new Date().toISOString(), id=startedAt.replaceAll(/[:.]/g,'-')+'-'+crypto.randomUUID();
  const archive=path.join(config.directory,`test1-${id}.archive.gz`), partial=archive+'.partial';
  try {
    // Full dedicated replica-set dump. The secret YAML must not select a database.
    await execute(config.mongodump,['--config='+config.mongoConfig,'--archive='+partial,'--gzip','--oplog']);
    const stat=await fs.stat(partial);if(!stat.isFile()||stat.size===0)throw new Error('Backup archive is empty');
    const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(partial))hash.update(chunk);
    await fs.rename(partial,archive);
    const manifest={status:'success',startedAt,finishedAt:new Date().toISOString(),archive:path.basename(archive),bytes:stat.size,sha256:hash.digest('hex'),codeVersion:config.codeVersion,schemaVersion:config.schemaVersion,oplog:true,offsite:'not-verified'};
    await fs.writeFile(archive+'.json',JSON.stringify(manifest,null,2),{mode:0o600});
    const latest=path.join(config.directory,'latest.json');
    await fs.writeFile(latest+'.tmp',JSON.stringify(manifest,null,2),{mode:0o640});await fs.chmod(latest+'.tmp',0o640);await fs.rename(latest+'.tmp',latest);
    // Retain all successful archives until offsite and 7 daily/4 weekly copies are verified.
    return manifest;
  } finally {process.umask(previousMask);await lock.close();await fs.unlink(lockPath);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try {const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));console.log(JSON.stringify(await runBackup(config)));}
  catch(error){console.error(JSON.stringify({status:'failed',reason:error.code||'backup-failed'}));process.exitCode=1;}
}
