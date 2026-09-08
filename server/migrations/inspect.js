// Read-only by default. This command never loads .env or accepts implicit production access.
import mongoose from 'mongoose';
import {readConfig} from '../config.js';
import '../app.js';
import '../models/Job.js';
const config=readConfig();
if(config.mode==='production')throw new Error('Production migrations require a separately reviewed release procedure');
await mongoose.connect(config.uri,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:5000});
try {
  const chapters=mongoose.connection.collection('chapters');
  const duplicates=await chapters.aggregate([{$group:{_id:{bookId:'$bookId',number:'$chapter_number'},ids:{$push:'$_id'},count:{$sum:1}}},{$match:{count:{$gt:1}}}]).toArray();
  const invalid=await chapters.countDocuments({$or:[{chapter_number:{$not:{$type:'number'}}},{chapter_number:{$lte:0}}]});
  const collections=await mongoose.connection.db.listCollections().toArray();
  const indexes={};for(const c of collections)indexes[c.name]=await mongoose.connection.collection(c.name).indexes();
  const report={version:'r3-v1',dryRun:!process.argv.includes('--apply'),duplicates,invalid,indexes};
  console.log(JSON.stringify(report,null,2));
  if(process.argv.includes('--apply')) {
    if(duplicates.length||invalid)throw new Error('Conflicts must be resolved without deleting original content');
    // Never drops indexes implicitly. Existing non-unique chapter index must be reviewed.
    for(const model of Object.values(mongoose.models))await model.createIndexes();
    await mongoose.connection.collection('migrations').updateOne({_id:'r3-v1'},{$setOnInsert:{appliedAt:new Date()}},{upsert:true});
  }
} finally {await mongoose.disconnect();}
