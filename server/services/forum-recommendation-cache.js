import mongoose from 'mongoose';

// Public features only. Expiration never starts work: the next real request
// refreshes a key, and concurrent callers share that single read.
const capacity=4*1024*1024,maxEntries=48,ttl=60000;
let connection,bytes=0,hits=0,misses=0,shared=0,generation=0;
const entries=new Map(),pending=new Map();
export function clearForumRecommendationCache() {
  generation++;entries.clear();pending.clear();bytes=0;
}
function ready() {
  if(connection!==mongoose.connection.db){connection=mongoose.connection.db;clearForumRecommendationCache();hits=misses=shared=0;}
}
export function forumRecommendationCacheMetrics() {
  ready();return {entries:entries.size,pending:pending.size,estimatedJsonBytes:bytes,capacityBytes:capacity,hits,misses,shared};
}
export async function cachedForumCandidates(key,load) {
  ready();const now=Date.now(),entry=entries.get(key);
  if(entry && entry.expires>now){hits++;entries.delete(key);entries.set(key,entry);return entry.value;}
  if(entry){entries.delete(key);bytes-=entry.bytes;}
  if(pending.has(key)){shared++;return pending.get(key);}
  const version=generation;misses++;
  const promise=Promise.resolve().then(load).then(value=>{
    if(version!==generation)return value;
    const size=Buffer.byteLength(JSON.stringify(value));
    if(size<=capacity){
      while(entries.size && (bytes+size>capacity || entries.size>=maxEntries)){
        const oldest=entries.keys().next().value;bytes-=entries.get(oldest).bytes;entries.delete(oldest);
      }
      entries.set(key,{value,bytes:size,expires:Date.now()+ttl});bytes+=size;
    }
    return value;
  }).finally(()=>{if(pending.get(key)===promise)pending.delete(key);});
  pending.set(key,promise);return promise;
}
