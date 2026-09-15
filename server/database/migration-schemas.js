// Load declarations without starting the API, workers or any database driver.
import '../app.js';
import {readdir} from 'node:fs/promises';
import mongoose from 'mongoose';

export async function migrationSchemas() {
  const directory=new URL('../models/',import.meta.url);
  for(const name of await readdir(directory))if(name.endsWith('.js'))await import(new URL(name,directory));
  const schemas=new Map(Object.values(mongoose.models).map(model=>[model.collection.name,model.schema]));
  // Migration names have always used string IDs through the native collection.
  schemas.set('migrations',new mongoose.Schema({_id:String},{strict:false}));
  return schemas;
}
