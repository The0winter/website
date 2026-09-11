import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';

test('catalog pages and full-book statistics stay complete, bounded and metadata-only',async()=>{
  const repl=await MongoMemoryReplSet.create({binary:{version:'7.0.40'},replSet:{count:1}});
  const config=readConfig({APP_ENV:'test',MONGO_URI:repl.getUri('test1_test'),JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri,{autoIndex:false,autoCreate:false,monitorCommands:true,serverSelectionTimeoutMS:5000});
  let server;
  try{
    await Chapter.createIndexes();
    const book=await Book.create({title:'Synthetic long catalog'});
    await Chapter.insertMany(Array.from({length:405},(_,i)=>({bookId:book._id,title:i<2?'Repeated title':`Chapter ${i+1}`,chapter_number:i+1,word_count:i+1,content:'Body must not be returned',deletedAt:i===202?new Date():null})));
    server=createApp(config).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const url=`http://127.0.0.1:${server.address().port}/api/books/${book._id}/chapters`;
    const commands=[];
    mongoose.connection.getClient().on('commandStarted',event=>commands.push(event));
    const first=await fetch(url+'?limit=200&page=1');
    const firstRows=await first.json();
    assert.equal(first.status,200);assert.equal(first.headers.get('X-Total-Count'),'404');
    assert.equal(firstRows.length,200);assert.equal(firstRows[0].title,firstRows[1].title);
    for(const row of firstRows){assert.ok(row.id);assert.equal(row.content,undefined);assert.equal(row.contentKey,undefined);}
    const query=commands.find(event=>event.commandName==='find'&&event.command.find==='chapters').command;
    assert.equal(query.singleBatch,true);assert.ok(query.batchSize>=200&&query.batchSize<=201);assert.equal(query.limit,200);
    assert.equal(commands.filter(event=>event.commandName==='getMore').length,0);
    assert.ok(commands.filter(event=>event.commandName==='find'||event.commandName==='aggregate').every(event=>event.command.maxTimeMS===3000));
    const second=await (await fetch(url+'?limit=200&page=2')).json();
    const last=await (await fetch(url+'?limit=200&page=3')).json();
    const all=[...firstRows,...second,...last];
    assert.deepEqual(all.map(row=>row.chapter_number),Array.from({length:405},(_,i)=>i+1).filter(number=>number!==203));
    assert.equal(new Set(all.map(row=>row.id)).size,404);
    const reversed=await (await fetch(url+'?limit=200&order=desc')).json();
    assert.equal(reversed.length,200);assert.equal(reversed[0].chapter_number,405);
    assert.deepEqual(await (await fetch(url+'?limit=200&page=4')).json(),[]);
    assert.equal((await fetch(url+'?limit=201')).status,400);
    assert.equal((await fetch(url+'?page=0')).status,400);
    const windowUrl = url.replace('/chapters', '/catalog');
    const anchor = all.find(row => row.chapter_number === 350);
    const windowResponse = await fetch(windowUrl + `?anchor=${anchor.id}&limit=128`);
    const window = await windowResponse.json();
    assert.equal(windowResponse.status, 200);
    assert.equal(window.total, 404); assert.equal(window.activeIndex, 348);
    assert.deepEqual(window.volumes, [{id: all[0].id, title: '正文', start: 0, count: 404}]);
    assert.equal(window.rows[window.activeIndex - window.offset].id, anchor.id);
    assert.deepEqual(window.rows.map(row => row.id), all.slice(window.offset, window.offset + window.rows.length).map(row => row.id));
    for (const row of window.rows) assert.deepEqual(Object.keys(row).sort(), ['chapter_number','id','title']);
    const bulk = await (await fetch(windowUrl + '?offset=0&limit=2048')).json();
    assert.equal(bulk.rows.length, 404);
    assert.equal((await fetch(windowUrl + '?limit=2049')).status, 400);
    assert.equal((await fetch(windowUrl + '?offset=-1')).status, 400);
    assert.equal((await fetch(windowUrl + '?anchor=invalid')).status, 400);
    await Chapter.updateOne({bookId: book._id, chapter_number: 1}, {$set: {title: '第一卷 起点 第1章 开始'}});
    await Chapter.updateOne({bookId: book._id, chapter_number: 101}, {$set: {title: '第二卷 远行 第1章 开始'}});
    await Chapter.updateOne({bookId: book._id, chapter_number: 301}, {$set: {title: '第三卷 番外 第1章 重逢'}});
    await Book.updateOne({_id: book._id}, {$inc: {writeVersion: 1}});
    const stale = await fetch(windowUrl + '?version=' + window.version);
    assert.equal(stale.status, 409); assert.equal((await stale.json()).rows, undefined);
    const missingAnchor = await (await fetch(windowUrl + `?anchor=${new mongoose.Types.ObjectId()}&limit=128`)).json();
    assert.equal(missingAnchor.activeIndex, null); assert.equal(missingAnchor.offset, 0);
    const grouped = await (await fetch(windowUrl + `?anchor=${anchor.id}&limit=1`)).json();
    assert.deepEqual(grouped.volumes.map(({title,start,count}) => ({title,start,count})), [
      {title:'第一卷 起点',start:0,count:100}, {title:'第二卷 远行',start:100,count:199}, {title:'第三卷 番外',start:299,count:105},
    ]);
    assert.equal(grouped.rows.length,1); assert.equal(grouped.rows[0].id,anchor.id);
    const statisticsUrl=url.replace('/chapters','/statistics');
    // Include metadata-only R2 chapters and legacy chapters without a count.
    await Chapter.collection.updateOne({bookId:book._id,chapter_number:405},{$unset:{content:''},$set:{contentKey:`chapters/sha256/${'a'.repeat(64)}.txt`}});
    await Chapter.collection.updateOne({bookId:book._id,chapter_number:1},{$unset:{word_count:''}});
    const other=await Book.create({title:'Unrelated book'});
    await Chapter.create({bookId:other._id,title:'Other chapter',chapter_number:1,word_count:99999,content:'Other content'});
    const statistics=await fetch(statisticsUrl);
    const expectedWords=405*406/2-203-1;
    assert.equal(statistics.status,200);
    assert.equal(statistics.headers.get('Cache-Control'),'no-store');
    assert.deepEqual(await statistics.json(),{totalWords:expectedWords});
    // A later visit must see edits and removals; the value is stable within a page, not stale forever.
    await Chapter.updateOne({bookId:book._id,chapter_number:2},{$set:{word_count:102}});
    await Chapter.updateOne({bookId:book._id,chapter_number:3},{$set:{deletedAt:new Date()}});
    assert.deepEqual(await (await fetch(statisticsUrl)).json(),{totalWords:expectedWords+100-3});
    assert.equal((await fetch(statisticsUrl.replace(String(book._id),'invalid'))).status,400);
    assert.equal((await fetch(statisticsUrl.replace(String(book._id),String(new mongoose.Types.ObjectId())))).status,404);
    await Book.updateOne({_id:book._id},{$set:{deletedAt:new Date()}});
    assert.equal((await fetch(url)).status,404);
    assert.equal((await fetch(windowUrl)).status,404);
    assert.equal((await fetch(statisticsUrl)).status,404);
    const empty=await Book.create({title:'Empty catalog'});
    const emptyResponse=await fetch(url.replace(String(book._id),String(empty._id)));
    assert.equal(emptyResponse.headers.get('X-Total-Count'),'0');assert.deepEqual(await emptyResponse.json(),[]);
    assert.equal((await (await fetch(windowUrl.replace(String(book._id), String(empty._id)))).json()).total, 0);
    assert.deepEqual(await (await fetch(statisticsUrl.replace(String(book._id),String(empty._id)))).json(),{totalWords:0});
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await mongoose.disconnect();await repl.stop();
  }
});
