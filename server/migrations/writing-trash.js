import mongoose from 'mongoose';
import {readConfig} from '../config.js';
import Chapter from '../models/Chapter.js';
import WriterDraft from '../models/WriterDraft.js';
import WriterDiscard from '../models/WriterDiscard.js';
import {trashDeadline} from '../services/writing-trash.js';

// Run once on rollout with the service environment. Only already-deleted chapters are adopted;
// their existing content gets a full seven-day recovery window starting at rollout.
const config = readConfig();
await mongoose.connect(config.uri, {autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:10000});
try {
  const filter = {deletedAt:{$ne:null},trashUntil:{$exists:false}};
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({mode:'preview',legacyChapters:await Chapter.countDocuments(filter)}));
  } else {
    await WriterDiscard.createCollection();
    await WriterDiscard.createIndexes();
    await WriterDraft.collection.createIndex({trashUntil:1},{sparse:true});
    await Chapter.collection.createIndex({trashUntil:1},{sparse:true});
    const result = await Chapter.updateMany(filter, {$set:{trashUntil:trashDeadline(new Date())}});
    console.log(JSON.stringify({mode:'apply',legacyChapters:result.modifiedCount,indexesReady:true}));
  }
} finally {await mongoose.disconnect();}
