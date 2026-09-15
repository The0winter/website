import mongoose from 'mongoose';
import {decode, encode} from './codec.js';
import {digest} from './snapshot.js';

const canonical = value => JSON.stringify(sortKeys(JSON.parse(value)));
function sortKeys(value) {
  if(Array.isArray(value))return value.map(sortKeys);
  return value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,sortKeys(value[k])])) : value;
}

// D1 preserves dates and bytes but stores ObjectIds as strings. Cast only
// declared ObjectId paths; string IDs, hashes and unknown legacy fields survive.
export function restoreBson(document,schema) {
  function cast(value,type) {
    if(value==null)return value;
    if(type.instance==='ObjectId') {
      if(typeof value!=='string'||!/^[a-f\d]{24}$/i.test(value))throw new Error('Invalid ObjectId at '+type.path);
      return new mongoose.Types.ObjectId(value);
    }
    if(type.schema)return Array.isArray(value)?value.map(v=>restoreBson(v,type.schema)):restoreBson(value,type.schema);
    if(type.instance==='Array')return value.map(v=>cast(v,type.caster));
    if(type.instance==='Map')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,cast(v,type.$__schemaType)]));
    return value;
  }
  for(const [path,type] of Object.entries(schema.paths)) {
    const parts=path.split('.'),key=parts.pop();let parent=document;
    for(const part of parts) {parent=parent?.[part];if(parent==null)break;}
    if(parent && Object.hasOwn(parent,key))parent[key]=cast(parent[key],type);
  }
  return document;
}

export function mongoDocuments(snapshot,schemas) {
  return snapshot.collections.map(collection=>{
    const schema=schemas.get(collection.name);
    if(!schema && collection.documents.some(row=>!row.bson))throw new Error('Missing migration schema: '+collection.name);
    return {...collection,values:collection.documents.map(row=>{
      const document=row.bson?mongoose.mongo.BSON.EJSON.parse(row.bson,{relaxed:false}):restoreBson(decode(row.document),schema);
      const normalized=mongoose.mongo.BSON.deserialize(mongoose.mongo.BSON.serialize(document));
      if(canonical(encode(normalized))!==canonical(row.document))throw new Error('BSON conversion changed data: '+collection.name);
      return document;
    })};
  });
}

const bsonFingerprint = doc => canonical(mongoose.mongo.BSON.EJSON.stringify(doc,{relaxed:false}));

// Only an inactive, empty target or an identical partial import is accepted.
// Existing divergent data is never overwritten or deleted. TTL indexes are
// installed after verification so expired receipts cannot hide import errors.
export async function restoreMongoSnapshot(db,snapshot,schemas,{inactiveTarget,progress=()=>{}}={}) {
  if(inactiveTarget!==db.databaseName)throw new Error('Exact inactive target database is required');
  const collections=mongoDocuments(snapshot,schemas),byName=new Map(collections.map(c=>[c.name,c]));
  const names=(await db.listCollections({}, {nameOnly:true}).toArray()).map(c=>c.name);
  if(names.some(name=>!byName.has(name)))throw new Error('Target contains collections outside this snapshot');
  const present=new Map();
  for(const c of collections) {
    const expected=new Map(c.values.map(doc=>[String(doc._id),bsonFingerprint(doc)])),ids=new Set();
    if(names.includes(c.name))for await(const doc of db.collection(c.name).find({})) {
      if(expected.get(String(doc._id))!==bsonFingerprint(doc))throw new Error('Target differs from snapshot: '+c.name);
      ids.add(String(doc._id));
    }
    present.set(c.name,ids);
  }
  for(const c of collections) {
    if(!names.includes(c.name))await db.createCollection(c.name);
    const missing=c.values.filter(doc=>!present.get(c.name).has(String(doc._id)));
    for(let i=0;i<missing.length;i+=200)await db.collection(c.name).insertMany(missing.slice(i,i+200),{ordered:true});
    for(const index of c.indexes) {
      if(index.name==='_id_' || index.expireAfterSeconds!==undefined)continue;
      await db.collection(c.name).createIndex(index.key,indexOptions(index));
    }
    progress({name:c.name,count:c.values.length,inserted:missing.length});
  }
  const report=await verifyMongoSnapshot(db,snapshot,schemas);
  return {...report,ttlIndexesDeferred:collections.flatMap(c=>c.indexes.filter(i=>i.expireAfterSeconds!==undefined).map(i=>({collection:c.name,index:i.name})))};
}

function indexOptions(index) {
  return Object.fromEntries(['name','unique','sparse','expireAfterSeconds','partialFilterExpression','collation','hidden'].filter(k=>index[k]!==undefined).map(k=>[k,index[k]]));
}

export async function activateMongoTtl(db,snapshot) {
  for(const c of snapshot.collections)for(const index of c.indexes) {
    if(index.expireAfterSeconds!==undefined)await db.collection(c.name).createIndex(index.key,indexOptions(index));
  }
}

export async function verifyMongoSnapshot(db,snapshot,schemas) {
  const report=[];
  for(const c of mongoDocuments(snapshot,schemas)) {
    const expected=new Map(c.values.map(doc=>[String(doc._id),bsonFingerprint(doc)]));
    const actual=[];
    for await(const doc of db.collection(c.name).find({})) {
      const id=String(doc._id),bson=bsonFingerprint(doc);
      if(expected.get(id)!==bson)throw new Error('MongoDB verification failed: '+c.name);
      expected.delete(id);actual.push(id+'\0'+bson);
    }
    if(expected.size)throw new Error('MongoDB verification missing documents: '+c.name);
    report.push({name:c.name,count:actual.length,sha256:digest(actual.sort().join('\n'))});
  }
  return {verified:true,collections:report};
}
