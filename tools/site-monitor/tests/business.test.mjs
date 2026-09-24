import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from '../../../server/node_modules/mongoose/index.js';
import {MongoMemoryServer} from '../../../server/node_modules/mongodb-memory-server/index.js';
import {readBusiness} from '../business.mjs';

test('业务统计用北京时间，剔除展示基数，按现存账号重建增长，只返回公开作品聚合',async t=>{
  const mongo=await MongoMemoryServer.create({binary:{version:'7.0.40'}});t.after(()=>mongo.stop());
  const connection=await mongoose.createConnection(mongo.getUri(),{autoCreate:false,autoIndex:false}).asPromise();t.after(()=>connection.close());
  const db=connection.db,now=Date.parse('2026-09-23T17:00:00Z');
  const publicId=new mongoose.Types.ObjectId(),privateId=new mongoose.Types.ObjectId(),deletedId=new mongoose.Types.ObjectId();
  await db.collection('users').insertMany([{username:'never-return-this',created_at:new Date('2026-09-23T15:59:00Z')},{created_at:new Date('2026-09-23T16:01:00Z')},{created_at:new Date('2026-09-10T12:00:00Z')},{created_at:new Date('2026-08-01T12:00:00Z')},{created_at:'unknown'}]);
  await db.collection('books').insertMany([{_id:publicId,title:'公开书',visibility:'public',views:999999},{_id:privateId,title:'私有书',visibility:'private'},{_id:deletedId,title:'删除书',deletedAt:new Date()}]);
  await db.collection('readdailies').insertMany([{bookId:publicId,day:'2026-09-23',views:1007,baselineViews:1000},{bookId:publicId,day:'2026-09-22',views:2},{bookId:publicId,day:'2026-09-21',views:9,baselineViews:10},{bookId:publicId,day:'2026-09-10',views:15},{bookId:publicId,day:'2026-09-24',views:50},{bookId:privateId,day:'2026-09-23',views:5},{bookId:deletedId,day:'2026-09-23',views:3}]);
  await db.collection('bookmarks').insertMany([{bookId:publicId,user_id:new mongoose.Types.ObjectId()},{bookId:publicId,user_id:new mongoose.Types.ObjectId()},{bookId:privateId,user_id:new mongoose.Types.ObjectId()}]);
  const before=await db.collection('readdailies').find().toArray();
  const data=await readBusiness(db,{days:7},now);
  assert.equal(data.startDate,'2026-09-17');assert.equal(data.endDate,'2026-09-23');assert.equal(data.totalUsers,5);assert.equal(data.todayNewUsers,1);assert.equal(data.unknownRegistrationDates,1);assert.equal(data.current.newUsers,1);assert.equal(data.previous.newUsers,1);
  assert.equal(data.current.reads,17);assert.equal(data.previous.reads,15);assert.equal(data.excludedBaseline,1010);assert.equal(data.daily.length,7);assert.equal(data.topBooks.length,1);assert.equal(data.topBooks[0].views,9);assert.equal(data.bookmarks[0].count,2);assert.equal(data.bookmarks.length,1);
  assert.ok(!JSON.stringify(data).includes('never-return-this'));assert.ok(!JSON.stringify(data).includes('user_id'));assert.deepEqual(await db.collection('readdailies').find().toArray(),before);
});
