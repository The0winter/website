// Run on the existing VPS with private env files; never put tokens or database
// dumps in command arguments, logs, the repository, or the public covers bucket.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import mongoose from '../server/node_modules/mongoose/index.js';
import {PutObjectCommand,GetObjectCommand} from '../server/node_modules/@aws-sdk/client-s3/dist-cjs/index.js';
import {connectDatabase} from '../server/database/index.js';
import {r2Client} from '../server/services/r2.js';
import {snapshotMongo,snapshotSql,packSnapshot,unpackSnapshot,snapshotSummary,restoreSnapshot,digest} from '../server/database/snapshot.js';
import {encode,decode} from '../server/database/codec.js';
import {createChapterStorage} from '../server/services/chapter-storage.js';

export async function saveCloudBackup(snapshot,{directory,kind='d1',keepLocal=false}={}) {
  if(!path.isAbsolute(directory))throw new Error('Absolute backup directory required');
  if(!process.env.R2_BUCKET || process.env.R2_BUCKET===process.env.COVER_R2_BUCKET)throw new Error('Backups require the private chapter bucket');
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const bytes=packSnapshot(snapshot),sha256=digest(bytes),startedAt=new Date().toISOString();
  const name=`${kind}-${startedAt.replaceAll(/[:.]/g,'-')}-${sha256.slice(0,12)}.json.gz`;
  const key='backups/database/'+name,client=r2Client();
  try {
    await client.send(new PutObjectCommand({Bucket:process.env.R2_BUCKET,Key:key,Body:bytes,ContentType:'application/gzip',Metadata:{sha256,format:snapshot.format}}));
    const result=await client.send(new GetObjectCommand({Bucket:process.env.R2_BUCKET,Key:key}));
    if(digest(await result.Body.transformToByteArray())!==sha256)throw new Error('R2 backup readback mismatch');
    const manifest={status:'success',startedAt,finishedAt:new Date().toISOString(),archive:name,bytes:bytes.length,sha256,offsite:'R2-verified',bucket:process.env.R2_BUCKET,key,...snapshotSummary(snapshot)};
    if(keepLocal)await fs.writeFile(path.join(directory,name),bytes,{mode:0o600,flag:'wx'});
    await fs.writeFile(path.join(directory,name+'.json'),JSON.stringify(manifest,null,2),{mode:0o600});
    await fs.writeFile(path.join(directory,'latest.json.tmp'),JSON.stringify(manifest,null,2),{mode:0o600});
    await fs.rename(path.join(directory,'latest.json.tmp'),path.join(directory,'latest.json'));
    return manifest;
  } finally {client.destroy();}
}

async function main() {
  const [action,...args]=process.argv.slice(2),option=name=>args.find(arg=>arg.startsWith('--'+name+'='))?.slice(name.length+3);
  const directory=option('directory')||'/srv/test1/backups/cloudflare';
  if(action==='snapshot-mongo') {
    if(!process.env.MONGO_URI)throw new Error('Explicit Mongo source required');
    const snapshot=await snapshotMongo(process.env.MONGO_URI);
    console.log(JSON.stringify(await saveCloudBackup(snapshot,{directory,kind:'mongo-source',keepLocal:true})));
    return;
  }
  const target=`d1://${process.env.CLOUDFLARE_ACCOUNT_ID}/${process.env.CLOUDFLARE_D1_DATABASE_ID}`;
  if(action==='import' && (option('inactive-target')!==process.env.CLOUDFLARE_D1_DATABASE_ID || process.env.WRITE_MODE!=='readonly'))throw new Error('Import requires exact inactive target and readonly migration environment');
  if(!['import','backup','verify'].includes(action))throw new Error('Usage: cloudflare-data.mjs snapshot-mongo|import|verify|backup [--file=absolute-snapshot] [--inactive-target=database-id]');
  await connectDatabase(target);
  try {
    if(action==='backup') {console.log(JSON.stringify(await saveCloudBackup(await snapshotSql(mongoose.connection),{directory})));return;}
    const filename=option('file');if(!filename || !path.isAbsolute(filename))throw new Error('Absolute snapshot file required');
    const snapshot=unpackSnapshot(await fs.readFile(filename));
    if(args.includes('--chapter-bodies=r2')) {
      const client=r2Client(),storage=createChapterStorage({client,bucket:process.env.R2_BUCKET});
      let moved=0;
      try {
        for(const row of snapshot.collections.find(c=>c.name==='chapters')?.documents||[]) {
          const doc=decode(row.document);
          if(typeof doc.content!=='string')continue;
          Object.assign(doc,await storage.write(doc.content));delete doc.content;
          row.document=encode(doc);moved++;
        }
      } finally {client.destroy();}
      console.log(JSON.stringify({chapterBodiesInR2:moved}));
    }
    if(action==='import') {
      await restoreSnapshot(mongoose.connection,snapshot,{inactiveTarget:true,progress:result=>console.log(JSON.stringify(result))});
      console.log(JSON.stringify({verified:true,metrics:mongoose.connection.transport.metrics}));
    } else {
      const current=await snapshotSql(mongoose.connection),byName=new Map(current.collections.map(c=>[c.name,c]));
      for(const collection of snapshot.collections) {
        const rows=byName.get(collection.name)?.documents;
        if(rows?.length!==collection.documents.length || rows.some((row,i)=>row.id!==collection.documents[i].id || row.document!==collection.documents[i].document))throw new Error('Verification failed: '+collection.name);
      }
      console.log(JSON.stringify({verified:true,collections:snapshot.collections.length,documents:snapshot.collections.reduce((n,c)=>n+c.documents.length,0)}));
    }
  } finally {await mongoose.disconnect();}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({failed:true,code:error.code||error.name,message:/^Verification failed|^Snapshot verification failed|^Index needs explicit/.test(error.message)?error.message:'Cloudflare data operation failed; no success was recorded'}));process.exitCode=1;});
