import {createHash,randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import mongoose from 'mongoose';
import {encode,decode,identifier,literal} from './codec.js';

const FORMAT='test1-cloudflare-documents-v1';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const packSnapshot=snapshot=>gzipSync(Buffer.from(JSON.stringify(snapshot)));
export function unpackSnapshot(bytes) {
  const snapshot=JSON.parse(gunzipSync(bytes));
  if(snapshot.format!==FORMAT || !Array.isArray(snapshot.collections))throw new Error('Unknown snapshot format');
  const names=new Set();
  for(const collection of snapshot.collections) {
    identifier(collection.name);
    if(collection.name.startsWith('_') || names.has(collection.name))throw new Error('Invalid snapshot collection');
    names.add(collection.name);const ids=new Set();
    for(const row of collection.documents) {
      if(typeof row.document!=='string'||String(decode(row.document)._id)!==row.id||ids.has(row.id))throw new Error('Invalid snapshot document');
      ids.add(row.id);
    }
  }
  return snapshot;
}

export async function snapshotMongo(uri) {
  const client=new mongoose.mongo.MongoClient(uri,{serverSelectionTimeoutMS:10000});
  await client.connect();
  const db=client.db(),session=client.startSession();
  try {
    const names=(await db.listCollections({type:'collection'}).toArray()).map(row=>row.name).sort();
    const indexes=new Map();
    for(const name of names)indexes.set(name,await db.collection(name).indexes());
    let collections;
    await session.withTransaction(async()=>{
      collections=[];
      for(const name of names) {
        const documents=[];
        for await(const doc of db.collection(name).find({},{session})) {
          documents.push({id:String(doc._id),document:encode(doc),bson:mongoose.mongo.BSON.EJSON.stringify(doc,{relaxed:false})});
        }
        documents.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
        collections.push({name,indexes:indexes.get(name),documents});
      }
    },{readConcern:{level:'snapshot'},readPreference:'primary'});
    return {format:FORMAT,source:'MongoDB',database:db.databaseName,createdAt:new Date().toISOString(),collections};
  } finally {await session.endSession();await client.close();}
}

export async function collectionRows(connection,name) {
  const rows=[];let last;
  for(;;) {
    const page=await connection.transport.query(`SELECT id,document FROM ${identifier(name)}${last===undefined?'':' WHERE id>'+literal(last)} ORDER BY id LIMIT 500`);
    rows.push(...page);if(page.length<500)break;last=page.at(-1).id;
  }
  return rows;
}

export async function snapshotSql(connection) {
  for(let attempt=0;attempt<5;attempt++) {
    const revision=(await connection.transport.query('SELECT revision FROM _d1_meta WHERE id=1'))[0].revision;
    const collections=[];
    const names=(await connection.db.listCollections().toArray()).map(row=>row.name).sort();
    for(const name of names)collections.push({name,indexes:await connection.collection(name).indexes(),documents:await collectionRows(connection,name)});
    if((await connection.transport.query('SELECT revision FROM _d1_meta WHERE id=1'))[0].revision===revision) {
      return {format:FORMAT,source:'D1',database:connection.name,revision,createdAt:new Date().toISOString(),collections};
    }
  }
  throw new Error('Database changed during backup; no inconsistent snapshot was saved');
}

export function snapshotSummary(snapshot) {
  return {source:snapshot.source,createdAt:snapshot.createdAt,collections:snapshot.collections.map(c=>({name:c.name,count:c.documents.length,sha256:digest(c.documents.map(row=>row.id+'\0'+row.document+'\n').join(''))}))};
}

// This is only for a reviewed, inactive migration/restore target. Source deletion
// is never performed. Existing target rows are reconciled to the full snapshot.
export async function restoreSnapshot(connection,snapshot,{inactiveTarget=false,progress=()=>{}}={}) {
  if(!inactiveTarget)throw new Error('Restore requires an inactive target');
  const report=[];
  for(const collection of snapshot.collections) {
    const {name,documents,indexes}=collection;
    await connection.ensureCollection(name);
    const existing=new Map((await collectionRows(connection,name)).map(row=>[row.id,row.document]));
    let statements=[],bytes=0,changed=0,removed=0;
    const flush=async()=>{if(statements.length)await connection.transport.batch(statements);statements=[];bytes=0;};
    const add=async sql=>{if(statements.length>=40 || bytes+Buffer.byteLength(sql)>75000)await flush();statements.push(sql);bytes+=Buffer.byteLength(sql);};
    for(const row of documents) {
      const before=existing.get(row.id);existing.delete(row.id);
      if(before===row.document)continue;
      let value=literal(row.document),staged;
      if(Buffer.byteLength(value)>80000){staged=randomUUID();await connection.transport.stageValue(staged,row.document);value=`(SELECT document FROM _d1_values WHERE id=${literal(staged)})`;}
      await add(`INSERT INTO ${identifier(name)}(id,document) VALUES(${literal(row.id)},${value}) ON CONFLICT(id) DO UPDATE SET document=excluded.document,revision=revision+1`);
      if(staged)await add(`DELETE FROM _d1_values WHERE id=${literal(staged)}`);
      changed++;
    }
    for(const id of existing.keys()){await add(`DELETE FROM ${identifier(name)} WHERE id=${literal(id)}`);removed++;}
    await flush();
    for(const index of indexes) {
      if(index.name==='_id_')continue;
      if(index.collation || index.hidden)throw new Error('Index needs explicit migration: '+name+'/'+index.name);
      const options=Object.fromEntries(['name','unique','sparse','expireAfterSeconds','partialFilterExpression'].filter(k=>index[k]!==undefined).map(k=>[k,index[k]]));
      await connection.collection(name).createIndex(index.key,options);
    }
    const actual=await collectionRows(connection,name);
    if(actual.length!==documents.length || actual.some((row,i)=>row.id!==documents[i].id || row.document!==documents[i].document))throw new Error('Snapshot verification failed: '+name);
    const result={name,count:actual.length,changed,removed,verified:true};report.push(result);progress(result);
  }
  return report;
}
