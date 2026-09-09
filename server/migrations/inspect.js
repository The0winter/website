// No dotenv, implicit target, destructive fixes or automatic index drops.
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {readConfig} from '../config.js';
import {inventory} from './inventory.js';
import '../app.js';
import '../models/Job.js';
const config=readConfig(),apply=process.argv.includes('--apply');
const option=name=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
const target=crypto.createHash('sha256').update(config.uri).digest('hex');
if(config.mode==='production'&&option('production-target')!==target)throw new Error('Production requires the exact reviewed URI fingerprint; this is not deployment authorization');
await mongoose.connect(config.uri,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:5000,socketTimeoutMS:15000,maxPoolSize:3});
try{
  const report=await inventory(mongoose.connection,mongoose.models);
  console.log(JSON.stringify({...report,target,dryRun:!apply},null,2));
  if(apply){
    if(report.issues.length)throw new Error('Resolve reported conflicts in a reviewed preservation migration; no automatic deletion');
    if(option('approved-fingerprint')!==report.fingerprint)throw new Error('Apply requires the unchanged dry-run fingerprint');
    for(const model of Object.values(mongoose.models))await model.createIndexes();
    await mongoose.connection.collection('migrations').updateOne({_id:report.version},{$setOnInsert:{appliedAt:new Date(),fingerprint:report.fingerprint}},{upsert:true});
    console.log(JSON.stringify({applied:report.version}));
  }
}finally{await mongoose.disconnect();}
