import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {connectDatabase} from '../database/index.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import {selectDiscoveryBooks} from '../services/discovery.js';
import {mongoUsageSnapshot} from '../services/mongo-usage.js';

test('compact lists preserve exact results and detail previews share reads while retaining fresh metadata', async t => {
  const db=await TestDatabase.create();
  await connectDatabase(db.getUri());
  const config=readConfig({APP_ENV:'test',DATABASE_URL:db.getUri(),JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  const server=createApp(config).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const get=async path=>{const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`);assert.equal(response.status,200);return response.json();};
  try {
    await Book.insertMany(Array.from({length:90},(_,i)=>({title:`Fixture ${i}`,author:`Author ${i%13}`,category:'测试',views:i,rating:i%5,
      description:'简介'.repeat(200),statisticsSeed:{favorites:200,views:i,initializedAt:new Date(),rating:4,ratingWeight:20,runId:'audit'.repeat(200)}})));
    const commands=[], client=mongoose.connection.transport ? null : mongoose.connection.getClient();
    client?.on('commandStarted',e=>commands.push(e.command));
    const all=await Book.find({deletedAt:null,visibility:{$ne:'private'}}).lean();
    const fields=['_id','title','author','cover_image','category','description','rating','views','rankingViews','rankingScore','id'];
    for (const sort of ['views','rating','composite','rank_total','rank_day','discovery','featured_daily']) {
      const path=`/api/books?orderBy=${sort}&limit=20`;
      const full=await get(path); commands.length=0;
      const compact=await get(path+'&fields=ranking');
      assert.deepEqual(compact,full.map(book=>Object.fromEntries(fields.filter(f=>f in book).map(f=>[f,book[f]]))),sort);
      if (client) {
        const find=commands.filter(c=>c.find==='books');
        assert.ok(find.every(c=>c.projection && !c.projection.statisticsSeed),`${sort}: field selection reaches MongoDB`);
        for (const aggregate of commands.filter(c=>c.aggregate==='books')) {
          if (!aggregate.pipeline.some(p=>p.$sort || p.$facet)) continue; // countDocuments returns only its count.
          const project=aggregate.pipeline.find(p=>p.$facet)?.$facet.rows.at(-1)?.$project || aggregate.pipeline.at(-1).$project;
          assert.ok(project?.title && !project.statisticsSeed,`${sort}: project rows before leaving MongoDB`);
        }
      }
    }
    const selected=selectDiscoveryBooks(all,59).slice(0,20).map(b=>String(b._id));
    assert.deepEqual((await get('/api/books?orderBy=discovery&limit=20')).map(b=>b.id),selected);
    const book=all[0];
    const chapter=await Chapter.create({bookId:book._id,title:'Original chapter',chapter_number:1,content:'正文',word_count:2});
    const originalFind=Chapter.find.bind(Chapter); let scans=0;
    t.mock.method(Chapter,'find',(...args)=>{scans++;return originalFind(...args);});
    const path=`/api/books/${book._id}/detail`;
    const concurrent=await Promise.all(Array.from({length:6},()=>get(path)));
    assert.equal(scans,2,'one shared index scan and one shared preview query');
    assert.ok(concurrent.every(data=>data.catalog.rows[0].title==='Original chapter'));
    await Book.updateOne({_id:book._id},{$set:{views:9999,description:'New description'}});
    const fresh=await get(path);
    assert.equal(fresh.book.views,9999);assert.equal(fresh.book.description,'New description');assert.equal(scans,2);
    await Chapter.updateOne({_id:chapter._id},{$set:{title:'Edited chapter'}});
    await Book.updateOne({_id:book._id},{$inc:{writeVersion:1}});
    assert.equal((await get(path)).catalog.rows[0].title,'Edited chapter');
    assert.equal(scans,4);
    commands.length=0;
    await get(`/api/chapters/${chapter._id}?navigation=1`);
    if (client) assert.ok(commands.some(c=>c.find==='books' && c.projection?.writeVersion && !c.projection.statisticsSeed));
    commands.length=0;
    await get(`/api/books/${book._id}/reviews`);
    if (client) assert.ok(commands.some(c=>c.find==='books' && c.projection?.statisticsSeed),'rating seeds remain available to reviews');
    if (client) {
      const measured=mongoUsageSnapshot().buckets.flatMap(bucket=>Object.entries(bucket.purposes));
      for (const purpose of ['list','detail','reading','reviews']) {
        assert.ok(measured.some(([name,row])=>name===purpose && row.commands>0 && row.estimatedBsonReplyBytes>0),purpose);
      }
    }
  } finally {await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await db.stop();}
});
