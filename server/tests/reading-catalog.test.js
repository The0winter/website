import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';

test('catalog pages stay complete, ordered, bounded and metadata-only in a single MongoDB batch',async()=>{
  const repl=await MongoMemoryReplSet.create({binary:{version:'7.0.40'},replSet:{count:1}});
  const config=readConfig({APP_ENV:'test',MONGO_URI:repl.getUri('test1_test'),JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri,{autoIndex:false,autoCreate:false,monitorCommands:true,serverSelectionTimeoutMS:5000});
  let server;
  try{
    await Chapter.createIndexes();
    const book=await Book.create({title:'Synthetic long catalog'});
    await Chapter.insertMany(Array.from({length:405},(_,i)=>({bookId:book._id,title:i<2?'Repeated title':`Chapter ${i+1}`,chapter_number:i+1,content:'Body must not be returned',deletedAt:i===202?new Date():null})));
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
    await Book.updateOne({_id:book._id},{$set:{deletedAt:new Date()}});
    assert.equal((await fetch(url)).status,404);
    const empty=await Book.create({title:'Empty catalog'});
    const emptyResponse=await fetch(url.replace(String(book._id),String(empty._id)));
    assert.equal(emptyResponse.headers.get('X-Total-Count'),'0');assert.deepEqual(await emptyResponse.json(),[]);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await mongoose.disconnect();await repl.stop();
  }
});
