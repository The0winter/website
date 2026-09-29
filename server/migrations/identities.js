import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import mongoose from 'mongoose';
import {connectDatabase} from '../database/index.js';
import Author from '../models/Author.js';
import Book from '../models/Book.js';
import {migrateIdentities} from '../services/identity-migration.js';

// Apply with API/import writers stopped. Only author references change; account
// identity reservations are additive. Preserve the snapshot for code rollback.
async function main(){
  const apply=process.argv.includes('--apply');
  const backup=process.argv.find(a=>a.startsWith('--backup='))?.slice(9);
  if(apply&&!backup)throw new Error('--apply requires a new --backup= path');
  await connectDatabase();
  try{
    if(apply){
      const [authors,books]=await Promise.all([Author.find().lean(),Book.find({author_profile_id:{$exists:true},author_id:null}).select('author author_profile_id').lean()]);
      await fs.writeFile(backup,JSON.stringify({createdAt:new Date(),authors,books}),{flag:'wx',mode:0o600});
    }
    console.log(JSON.stringify({apply,...await migrateIdentities({apply})}));
  }finally{await mongoose.disconnect();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
