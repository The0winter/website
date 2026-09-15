// Secrets come only from private environment files, never command arguments.
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from '../server/node_modules/mongoose/index.js';
import {unpackSnapshot,snapshotMongo} from '../server/database/snapshot.js';
import {migrationSchemas} from '../server/database/migration-schemas.js';
import {restoreMongoSnapshot,verifyMongoSnapshot,activateMongoTtl} from '../server/database/mongo-restore.js';
import {saveCloudBackup} from './cloudflare-data.mjs';

async function main() {
  const [action,...args]=process.argv.slice(2),option=name=>args.find(arg=>arg.startsWith('--'+name+'='))?.slice(name.length+3);
  const uri=process.env.DATABASE_URL||process.env.MONGO_URI;
  if(!/^mongodb(?:\+srv)?:\/\//.test(uri||''))throw new Error('Explicit MongoDB connection required');
  const directory=option('directory')||'/var/lib/test1-atlas-backup';
  if(action==='backup') {
    console.log(JSON.stringify(await saveCloudBackup(await snapshotMongo(uri),{directory,kind:'atlas',keepLocal:args.includes('--keep-local')})));
    return;
  }
  if(!['import','verify','activate-ttl'].includes(action))throw new Error('Usage: atlas-data.mjs import|verify|activate-ttl|backup');
  const file=option('file');if(!file||!path.isAbsolute(file))throw new Error('Absolute snapshot path required');
  const snapshot=unpackSnapshot(await fs.readFile(file));
  const client=new mongoose.mongo.MongoClient(uri,{serverSelectionTimeoutMS:15000,maxPoolSize:4});
  try {
    await client.connect();const db=client.db();
    if(process.env.WRITE_MODE!=='readonly'||option('inactive-target')!==db.databaseName)throw new Error('Migration requires readonly environment and exact inactive target');
    const schemas=await migrationSchemas();
    if(action==='activate-ttl') {
      await verifyMongoSnapshot(db,snapshot,schemas);
      await activateMongoTtl(db,snapshot);
      console.log(JSON.stringify({ttlActivated:true}));
    } else console.log(JSON.stringify(action==='import'
      ? await restoreMongoSnapshot(db,snapshot,schemas,{inactiveTarget:db.databaseName,progress:row=>console.log(JSON.stringify(row))})
      : await verifyMongoSnapshot(db,snapshot,schemas)));
  } finally {await client.close();}
}
main().catch(error=>{console.error(JSON.stringify({failed:true,code:error.code||error.name,message:/^(Target |Missing migration schema|BSON conversion|MongoDB verification|Invalid ObjectId|Migration requires)/.test(error.message)?error.message:'Atlas data operation failed; no success was recorded'}));process.exitCode=1;});
