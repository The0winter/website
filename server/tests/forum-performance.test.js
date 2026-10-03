import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {readConfig} from '../config.js';
import {createApp} from '../app.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import Post from '../models/ForumPost.js';
import Reply from '../models/ForumReply.js';
import {forumFeed} from '../services/forum-feed.js';
import {readForumPost} from '../services/forum-read.js';

test('bounded forum reads preserve permissions, mixed-stream cursor order, body identity and compression', async () => {
  const database = await TestDatabase.create();
  const config = readConfig({APP_ENV:'test', DATABASE_URL:database.getUri(), JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex:false, monitorCommands:true});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const server = createApp(config).listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const author = await User.create({username:'性能测试作者',email:'forum-performance@example.test',password:'synthetic-password-hash'});
    const [book, hidden] = await Book.create([{title:'公开作品',author:'作者'}, {title:'私密作品',author:'作者',visibility:'private'}]);
    const [question, privateQuestion, article, unanswered] = await Post.create([
      {title:'公开问题？',content:'<p>补充</p>',author:author._id,type:'question',bookId:book._id,replyCount:16},
      {title:'私密问题？',content:'不能泄露',author:author._id,type:'question',bookId:hidden._id,replyCount:1},
      {title:'独立文章',content:'<p>文章内容。</p>'.repeat(100),author:author._id,type:'article',bookId:book._id,replyCount:1},
      {title:'没有回答？',content:'问题补充',author:author._id,type:'question',replyCount:0},
    ]);
    const date = new Date('2026-01-01T00:00:00Z');
    const answers = await Reply.insertMany(Array.from({length:16},(_,i)=>({postId:question._id,author:author._id,
      content:`<p>回答 ${i} &lt;完整正文&gt;。</p>`+'<p>正文必须保留。</p>'.repeat(70),createdAt:date,likes:i%3,
      ...(i===0?{source:{author:'原文作者',url:'https://example.test/source'}}:{})})));
    const privateAnswer = await Reply.create({postId:privateQuestion._id,author:author._id,content:'私密正文',likes:100});
    const comment = await Reply.create({postId:article._id,author:author._id,content:'文章评论不可作为独立回答',likes:100});
    for (const tab of ['recommend','hot']) {
      const all = (await forumFeed({tab,limit:100})).items;
      assert.equal(all.length,18);
      assert.ok(!all.some(row=>[String(comment._id),String(privateAnswer._id)].includes(row.entryId)));
      assert.ok(all.some(row=>row.id===String(unanswered._id)));
      const seen=[]; let cursor=null;
      for (let page=0;page<10;page++) {
        const result=await forumFeed({tab,limit:5,paged:true,cursor});
        assert.ok(result.items.length<=5);
        assert.ok(result.items.every(row=>!row.topReply || row.topReply.content===''));
        seen.push(...result.items.map(row=>row.entryId));cursor=result.nextCursor;
        if(!cursor)break;
      }
      assert.equal(cursor,null);
      assert.deepEqual(seen,all.map(row=>row.entryId));
      assert.equal(new Set(seen).size,18);
    }
    const first=await forumFeed({limit:5,paged:true});
    const linked=await forumFeed({bookId:String(book._id),limit:20});
    assert.equal(linked.items.length,17);assert.equal(linked.total,17);
    const expected=(await forumFeed({limit:100})).items.map(row=>row.entryId);
    await Post.create({title:'新插入的文章',content:'新内容',type:'article',author:author._id});
    const remaining=[];let cursor=first.nextCursor;
    while(cursor){const next=await forumFeed({limit:5,paged:true,cursor});remaining.push(...next.items.map(row=>row.entryId));cursor=next.nextCursor;}
    assert.deepEqual([...first.items.map(row=>row.entryId),...remaining],expected,'new entries above the cursor must not shift subsequent pages');
    await assert.rejects(forumFeed({tab:'hot',paged:true,cursor:first.nextCursor}),/游标/);
    await assert.rejects(forumFeed({paged:true,cursor:'not-a-cursor'}),/游标/);
    const reading=await readForumPost(String(question._id),null,{reading:true,answerId:String(answers[0]._id)});
    assert.equal(reading.answer.content,answers[0].content);
    assert.equal(reading.answer.author.name,'原文作者');
    assert.equal(reading.post.bookTitle,'公开作品');
    assert.equal('likedBy' in reading.post,false);
    assert.equal('likedBy' in reading.answer,false);
    assert.equal(await readForumPost(String(question._id),null,{reading:true,answerId:String(comment._id)}),null);
    assert.equal(await readForumPost(String(privateQuestion._id),null,{reading:true}),null);
    const wire=await fetch(`${base}/api/forum/posts?view=answers&format=page&limit=5`,{headers:{'accept-encoding':'gzip'}});
    assert.equal(wire.headers.get('content-encoding'),'gzip');
    assert.equal(wire.headers.get('cache-control'),'private, no-store');
    assert.match(wire.headers.get('vary'),/Accept-Encoding/i);
    const mixedPage=(await wire.json()).items;
    assert.ok(mixedPage.length>0 && mixedPage.length<=5);
    assert.equal(new Set(mixedPage.map(row=>row.id)).size,mixedPage.length,'recommendation pages diversify questions while book discussion pagination remains complete');
    const uncompressed=await fetch(`${base}/api/forum/posts/${article._id}/reading`,{headers:{'accept-encoding':'identity'}});
    assert.equal(uncompressed.headers.get('content-encoding'),null);
    const articleResult=await uncompressed.json();
    assert.equal(articleResult.post.content,article.content);assert.equal(articleResult.answer,null);
    // Legacy imports can predate the write sanitizer; optimized reads keep the same boundary.
    await Post.collection.updateOne({_id:article._id},{$set:{content:'<p>保留正文</p><script>alert(1)</script><img src="x" onerror="alert(1)">'}});
    const sanitized=await (await fetch(`${base}/api/forum/posts/${article._id}/reading`)).json();
    assert.match(sanitized.post.content,/保留正文/);
    assert.doesNotMatch(sanitized.post.content,/<script|onerror/i);
    const notFound=await fetch(`${base}/api/forum/posts/${privateQuestion._id}/reading?answer=${privateAnswer._id}`);
    assert.equal(notFound.status,404);
    if(!mongoose.connection.transport){
      const commands=[];const listener=e=>{if(['find','aggregate'].includes(e.commandName))commands.push(e.commandName);};
      mongoose.connection.getClient().on('commandStarted',listener);
      await readForumPost(String(question._id),null,{reading:true,answerId:String(answers[0]._id)});
      assert.deepEqual(commands,['aggregate'],'initial document uses one database round trip');commands.length=0;
      await forumFeed({limit:5,paged:true});
      assert.deepEqual(commands,['aggregate','aggregate'],'one bounded query per merged stream');
      mongoose.connection.getClient().off('commandStarted',listener);
    }
    await Book.updateOne({_id:book._id},{$set:{deletedAt:new Date()}});
    assert.equal(await readForumPost(String(question._id),null,{reading:true}),null);
    assert.ok((await forumFeed({paged:true})).items.every(row=>row.bookId!==String(book._id)));
  } finally {await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await database.stop();}
});
