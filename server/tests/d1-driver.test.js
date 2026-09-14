import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {installSqlDriver} from '../database/driver.js';
import {encode,decode} from '../database/codec.js';

test('SQL document driver preserves typed values, constraints and atomic updates',async t=>{
  installSqlDriver();
  const schema=new mongoose.Schema({name:{type:String,required:true,unique:true},count:{type:Number,default:0},owner:mongoose.Schema.Types.ObjectId,when:Date,tags:[String],nested:{value:Number}},{timestamps:true});
  const Item=mongoose.models.D1DriverItem || mongoose.model('D1DriverItem',schema);
  await mongoose.connect('sqlite::memory:');
  t.after(()=>mongoose.disconnect());
  await Item.createIndexes();
  const owner=new mongoose.Types.ObjectId(),when=new Date('2026-09-15T00:00:00Z');
  const item=await Item.create({name:'中文与引号\'；',owner,when,tags:['a','b'],nested:{value:2}});
  assert.equal(item.count,0);
  const lean=await Item.findById(item._id).lean();
  assert.equal(String(lean.owner),String(owner));assert.equal(lean.when.toISOString(),when.toISOString());
  assert.equal((await Item.find({owner,when:{$gte:when}})).length,1);
  assert.equal((await Item.find({tags:'b'})).length,1);
  assert.equal((await Item.find({name:/中文/})).length,1);
  assert.deepEqual((await Item.findById(item._id).select('name -_id').lean()),{name:item.name});
  await assert.rejects(Item.create({name:item.name}),error=>error.code===11000);
  await Promise.all(Array.from({length:8},()=>Item.updateOne({_id:item._id},{$inc:{count:1}})));
  assert.equal((await Item.findById(item._id)).count,8);
  await mongoose.connection.transaction(async session=>{
    const first=await Item.findById(item._id).session(session);
    first.count+=2;await first.save({session});
    assert.equal((await Item.findById(item._id).session(session)).count,10);
    await Item.create([{name:'committed'}],{session});
  });
  await assert.rejects(mongoose.connection.transaction(async session=>{
    await Item.updateOne({_id:item._id},{$inc:{count:100}},{session});
    await Item.create([{name:'rolled-back'}],{session});
    throw new Error('abort');
  }),/abort/);
  assert.equal((await Item.findById(item._id)).count,10);assert.equal(await Item.exists({name:'rolled-back'}),null);
  await assert.rejects(mongoose.connection.transaction(async session=>{
    await Item.updateOne({_id:item._id},{$inc:{count:100}},{session});
    await Item.create([{name:'committed'}],{session});
  }),error=>error.code===11000);
  assert.equal((await Item.findById(item._id)).count,10);
  const changed=await Item.findOneAndUpdate({_id:item._id},[{$set:{count:{$add:['$count',3]}}}],{new:true});
  assert.equal(changed.count,13);
  await Item.updateOne({_id:item._id},{$setOnInsert:{count:999}},{upsert:true});
  assert.equal((await Item.findById(item._id)).name,item.name);
  assert.equal((await Item.aggregate([{$match:{owner}},{$group:{_id:'$owner',count:{$sum:'$count'}}}]))[0].count,13);
  assert.equal(decode(encode({content:Buffer.from('binary')})).content.toString(),'binary');
  const transport=mongoose.connection.transport,read=transport.query.bind(transport);let reads=0;
  transport.query=async sql=>{reads++;return read(sql);};
  await mongoose.connection.transaction(async session=>{
    await session.prefetch(Item.collection.name,{owner});
    const start=reads;
    for(let i=0;i<30;i++)await Item.updateOne({_id:item._id},{$inc:{count:1}},{session});
    assert.equal(reads,start,'partition updates must not issue a round trip for each chapter');
  });
  assert.equal((await Item.findById(item._id)).count,43);
});
