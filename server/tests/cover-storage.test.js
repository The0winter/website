import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {coverConfig,prepareCover,createCoverStorage,coverCacheControl} from '../services/cover-storage.js';

const env={COVER_STORAGE:'r2',COVER_R2_BUCKET:'book-covers',COVER_R2_ENDPOINT:`https://${'a'.repeat(32)}.r2.cloudflarestorage.com`,COVER_PUBLIC_BASE_URL:'https://img.example.test',COVER_R2_ACCESS_KEY_ID:'test',COVER_R2_SECRET_ACCESS_KEY:'test'};
test('cover configuration is separate from chapter storage',()=>{
 assert.equal(coverConfig({}),null);
 assert.equal(coverConfig(env).baseUrl,'https://img.example.test');
 assert.throws(()=>coverConfig({...env,R2_BUCKET:env.COVER_R2_BUCKET}));
 assert.throws(()=>coverConfig({...env,COVER_R2_ENDPOINT:'https://attacker.test'}));
 assert.throws(()=>coverConfig({...env,COVER_PUBLIC_BASE_URL:'http://img.example.test'}));
 assert.throws(()=>coverConfig({...env,COVER_R2_SECRET_ACCESS_KEY:''}));
});
test('covers validate image bytes, discard metadata and produce two bounded WebP sizes',async()=>{
 const original=await sharp({create:{width:1728,height:2304,channels:3,background:'#87956c'}}).jpeg().withMetadata().toBuffer();
 const variants=await prepareCover(original);
 assert.deepEqual(variants.map(v=>[v.width,v.height]),[[240,320],[480,640]]);
 for(const variant of variants){const metadata=await sharp(variant.bytes).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.exif,undefined);assert.ok(variant.bytes.length<original.length);}
 for(const bytes of [Buffer.from('<svg></svg>'),Buffer.alloc(8*1024*1024+1),Buffer.from('not a png')])await assert.rejects(prepareCover(bytes));
 const wide=await sharp({create:{width:1000,height:10,channels:3,background:'red'}}).png().toBuffer();await assert.rejects(prepareCover(wide));
});
test('R2 upload verifies bytes and cleans only its own fresh objects after failure',async()=>{
 const variants=await prepareCover(await sharp({create:{width:480,height:640,channels:3,background:'blue'}}).png().toBuffer());
 const id='a'.repeat(24), objects=new Map(),calls=[];
 let corrupt=false;
 const client={async send(command){const {Key,Body}=command.input;calls.push(command);
  if(command.constructor.name==='PutObjectCommand'){objects.set(Key,Body);return {};}
  if(command.constructor.name==='DeleteObjectCommand'){objects.delete(Key);return {};}
  return {Body:{transformToByteArray:async()=>corrupt?Buffer.from('bad'):objects.get(Key)}};
 }};
 const storage=createCoverStorage(coverConfig(env),client);
 const stored=await storage.write(id,variants);
 assert.equal(stored.publicUrl,`https://img.example.test/covers/${id}/480.webp`);
 assert.equal(stored.content,undefined);assert.equal(objects.size,2);
 for(const command of calls.filter(c=>c.constructor.name==='PutObjectCommand')){assert.equal(command.input.ContentType,'image/webp');assert.equal(command.input.CacheControl,coverCacheControl);}
 corrupt=true;
 await assert.rejects(storage.write('b'.repeat(24),variants),/readback/);
 assert.equal(objects.size,2);assert.ok([...objects.keys()].every(k=>k.includes(id)));
});
