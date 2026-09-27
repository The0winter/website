import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import ReadingHistory from '../models/ReadingHistory.js';

test('public recent books retain reading order, fill eight after hidden books and expose no progress', async () => {
  const db=await TestDatabase.create();
  const config=readConfig({APP_ENV:'test',DATABASE_URL:db.getUri(),JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri,{autoIndex:false});
  for(const model of Object.values(mongoose.models))await model.createIndexes();
  const server=createApp(config).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const user=await User.create({username:'Recent reader',email:'private@example.test',password:'not-public'});
    const root=`${base}/api/users/${user.id}`;
    assert.deepEqual(await (await fetch(root+'/recent-books')).json(),[]);
    const books=await Book.insertMany(Array.from({length:46},(_,i)=>({title:`Book ${i}`,visibility:i>=12?'private':'public',deletedAt:i===11?new Date():null,rating:4,description:'Do not expose full content'})));
    await ReadingHistory.insertMany(books.map((book,i)=>({userId:user._id,bookId:book._id,lastVisitedAt:new Date(100000-i),...(i===10?{}:{lastReadAt:new Date(1000+i)}),chapterId:new mongoose.Types.ObjectId()})));
    const other=await User.create({username:'Other reader',email:'other@example.test',password:'not-public'});
    await ReadingHistory.create({userId:other._id,bookId:books[10]._id,lastVisitedAt:new Date(),lastReadAt:new Date()});
    const response=await fetch(root+'/recent-books?limit=100');assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
    const rows=await response.json();assert.deepEqual(rows.map(row=>row.id),books.slice(2,10).reverse().map(book=>book.id));
    for(const row of rows){assert(Object.keys(row).every(key=>['id','title','author','cover_image','category','rating'].includes(key)));}
    assert.equal((await fetch(root+'/library?tab=history')).status,401);
    assert.equal((await fetch(base+'/api/users/bad/recent-books')).status,400);
    assert.equal((await fetch(base+'/api/users/000000000000000000999999/recent-books')).status,404);
    await User.updateOne({_id:user._id},{$set:{isBanned:true}});
    assert.equal((await fetch(root+'/recent-books')).status,404);
  } finally {await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await db.stop();}
});

