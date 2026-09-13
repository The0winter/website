import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import mongoose from '../server/node_modules/mongoose/index.js';
import {S3Client} from '../server/node_modules/@aws-sdk/client-s3/dist-cjs/index.js';
import {coverConfig,createCoverStorage} from '../server/services/cover-storage.js';
import {cleanUnusedCovers} from '../server/services/cover-retention.js';

export async function main(args=process.argv.slice(2)) {
  if(args.some(a=>!['--apply'].includes(a)) || args.length>1)throw Error('Usage: node infra/clean-unused-covers.mjs [--apply]');
  const apply=args.includes('--apply'),config=coverConfig();
  if(!config)throw Error('R2 cover storage unavailable');
  const root=fileURLToPath(new URL('../',import.meta.url));
  if(apply){
    if(process.env.WRITE_MODE!=='readwrite')throw Error('Cleanup paused during maintenance');
    const manifest=JSON.parse(await fs.readFile(path.join(root,'deployment-manifest.json'),'utf8'));
    if(!manifest.activatedAt || manifest.release!==await fs.realpath(root) || await fs.realpath('/srv/test1/current')!==manifest.release)throw Error('Cleanup requires the activated current release');
    const response=await fetch('http://127.0.0.1:5000/health/ready',{signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('API is not ready');
  }
  const client=new S3Client({region:'auto',endpoint:config.endpoint,credentials:config.credentials,maxAttempts:2});
  try {
    await mongoose.connect(process.env.MONGO_URI,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:10000});
    const report=await cleanUnusedCovers({storage:createCoverStorage(config,client),bucket:config.bucket,apply});
    if(apply && process.env.STATE_DIRECTORY){
      const target=path.join(process.env.STATE_DIRECTORY,'last-run.json');
      await fs.writeFile(target+'.tmp',JSON.stringify(report,null,2),{mode:0o600});
      await fs.rename(target+'.tmp',target);
    }
    console.log(JSON.stringify(report));
    if(report.failed)process.exitCode=1;
    return report;
  }finally{client.destroy();await mongoose.disconnect();}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({status:'failed',errorType:error.name}));process.exitCode=1;});
