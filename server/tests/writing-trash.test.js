import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import ChapterDraft from '../models/ChapterDraft.js';
import Manuscript from '../models/Manuscript.js';
import WriterPublication from '../models/WriterPublication.js';
import {dayKey} from '../services/content.js';
import WriterDraft from '../models/WriterDraft.js';
import WriterBlob from '../models/WriterBlob.js';
import {cleanupDraftObjects, insertedCharacters} from '../services/writing-drafts.js';
import {memoryWritingStorage} from './helpers/writing-storage.js';

import WriterDiscard from '../models/WriterDiscard.js';
import {purgeExpiredWritingTrash, TRASH_DAYS} from '../services/writing-trash.js';
import {configureChapterStorage} from '../services/chapter-storage.js';
test('recycle bin preserves and restores content, then purges after seven days', async t => {
  const repl = await MongoMemoryReplSet.create({binary: {version: '7.0.40'}, replSet: {count: 1, storageEngine: 'wiredTiger'}});
  const config = readConfig({APP_ENV: 'test', MONGO_URI: repl.getUri('test1_test'), JWT_SECRET: crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex: false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const app = createApp(config), storage = memoryWritingStorage();
  app.locals.writingStorage = storage;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    const jar = new Map();
    async function request(path, method = 'GET', data, csrf = true) {
      const headers = {};
      if (method !== 'GET' && csrf) {
        headers.origin = 'http://127.0.0.1:3000';
        headers['x-csrf-token'] = (await request('/api/auth/csrf')).data.csrfToken;
      }
      headers.cookie = [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
      if (data) headers['content-type'] = 'application/json';
      const response = await fetch(base + path, {method, headers, body: data && JSON.stringify(data)});
      for (const cookie of response.headers.getSetCookie()) {const [key, ...value] = cookie.split(';')[0].split('='); jar.set(key, value.join('='));}
      return {status: response.status, data: await response.json()};
    }
    return request;
  }

  configureChapterStorage({read: storage.readChapter, write: storage.publish});
  try {
    const password = await bcrypt.hash('Writing-test-123', 10);
    const [user, stranger] = await User.create([{username:'回收测试',email:'trash@example.test',password},{username:'其他人',email:'other@example.test',password}]);
    const owner = client(), other = client();
    for (const [request, account] of [[owner,user],[other,stranger]]) assert.equal((await request('/api/auth/signin','POST',{email:account.email,password:'Writing-test-123'})).status,200);
    const key = crypto.randomUUID(), reference = `m_${key}`, path = `/api/writer/workspace/${reference}`;
    await Manuscript.create({_id:`${user.id}:${key}`,owner:user.id,title:'回收站测试',chapters:[{title:'原始章节',content:'七天后应一起清除的旧正文。'},{title:'保留章节',content:'不受影响的正文。'}]});
    const data = {id:'manuscript-0',number:1,title:'云端章节',content:'删除和复原都不能丢失的云端正文😀。',revision:0};
    let saved;
    await t.test('draft deletion never fetches or erases R2 content and requires owner/revision/CSRF', async () => {
      saved = await owner(path+'/drafts/'+data.id,'PUT',data); assert.equal(saved.status,200);
      const record = await WriterDraft.findOne({draftId:data.id}), originalKey = record.contentKey;
      const used = (await User.findById(user.id)).daily_upload_words;
      assert.equal((await other(path+`/trash/drafts/${data.id}/delete`,'POST',{revision:1})).status,404);
      assert.equal((await owner(path+`/trash/drafts/${data.id}/delete`,'POST',{revision:1},false)).status,403);
      assert.equal((await owner(path+`/trash/drafts/${data.id}/delete`,'POST',{revision:8})).status,409);
      const read = storage.read; storage.read = async () => {throw Error('Cloud read temporarily unavailable');};
      let deleted;
      try {deleted = await owner(path+`/trash/drafts/${data.id}/delete`,'POST',{revision:1});} finally {storage.read = read;}
      assert.equal(deleted.status,200,JSON.stringify(deleted));
      assert.equal(deleted.data.cloudRevision,2);
      const trashed = await WriterDraft.findById(record.id);
      assert.equal(trashed.contentKey,originalKey); assert.equal(await storage.read(trashed),data.content);
      assert.equal(trashed.trashUntil-trashed.deletedAt,TRASH_DAYS*86400000);
      assert.equal((await User.findById(user.id)).daily_upload_words,used);
      assert.equal((await owner(path+'/drafts/'+data.id)).status,404);
      const snapshot = (await owner(path)).data;
      assert.equal(snapshot.trash.length,1); assert.equal(snapshot.trash[0].kind,'draft'); assert.equal(snapshot.trash[0].words,Array.from(data.content).length);
      const deadline = trashed.trashUntil.getTime();
      assert.equal((await owner(path+`/trash/drafts/${data.id}/delete`,'POST',{revision:1})).status,200);
      assert.equal((await WriterDraft.findById(record.id)).trashUntil.getTime(),deadline);
      await cleanupDraftObjects(storage,new Date(Date.now()+2*86400000)); assert.equal(storage.objects.has(originalKey),true);
    });
    await t.test('restoration keeps exact content and id; old delete clients also recycle safely', async () => {
      assert.equal((await owner(path+`/trash/drafts/${data.id}/restore`,'POST',{revision:2})).status,200);
      const restored = await owner(path+'/drafts/'+data.id); assert.equal(restored.data.content,data.content); assert.equal(restored.data.cloudRevision,3);
      assert.equal((await owner(path)).data.trash.length,0);
      // Compatibility with the already deployed UI, which sent an empty body on deletion.
      const read=storage.read;storage.read=async()=>{throw Error('A delete must not read the body');};
      try {assert.equal((await owner(path+'/drafts/'+data.id,'PUT',{...data,content:'',revision:3,deleted:true})).status,200);} finally {storage.read=read;}
      const trashed=await WriterDraft.findOne({draftId:data.id}); assert.equal(await storage.read(trashed),data.content);
      assert.equal((await owner(path+`/trash/drafts/${data.id}/restore`,'POST',{revision:4})).status,200);
    });
    await t.test('published chapters recycle and restore with their original ID and bytes', async () => {
      const result=await owner(path+'/publish','POST',{id:data.id,title:data.title,content:data.content,number:1,cloudRevision:5});assert.equal(result.status,200,JSON.stringify(result));
      const {bookId,chapterId}=result.data;
      assert.equal((await other('/api/chapters/'+chapterId,'DELETE')).status,403);
      const deleted=await owner('/api/chapters/'+chapterId,'DELETE');assert.equal(deleted.status,200,JSON.stringify(deleted));
      assert.equal((await owner('/api/chapters/'+chapterId)).status,404);
      let snapshot=(await owner(path)).data;assert.equal(snapshot.total,0);assert.equal(snapshot.trash[0].sourceId,chapterId);assert.equal(snapshot.trash[0].kind,'chapter');
      const restored=await owner('/api/chapters/'+chapterId+'/restore','POST');assert.equal(restored.status,200,JSON.stringify(restored));assert.equal(restored.data.content,data.content);assert.equal(restored.data.id,chapterId);
      snapshot=(await owner(path)).data;assert.equal(snapshot.total,1);assert.equal(snapshot.trash.length,0);
      await owner('/api/chapters/'+chapterId,'DELETE');
      const record=await Chapter.findById(chapterId), deadline=record.trashUntil;
      await owner('/api/chapters/'+chapterId,'DELETE');assert.equal((await Chapter.findById(chapterId)).trashUntil.getTime(),deadline.getTime());
      assert.deepEqual(await purgeExpiredWritingTrash(new Date(deadline.getTime()-1)),{purgedDrafts:0,purgedChapters:0});
      await Chapter.updateOne({_id:chapterId},{$set:{trashUntil:new Date(Date.now()-1000)}});
      assert.equal((await owner('/api/chapters/'+chapterId+'/restore','POST')).status,410);
      assert.deepEqual(await purgeExpiredWritingTrash(),{purgedDrafts:0,purgedChapters:1});
      assert.equal(await Chapter.findById(chapterId),null);
      assert.equal(await WriterDraft.findOne({draftId:data.id}),null);
      assert.equal((await Manuscript.findById(`${user.id}:${key}`)).chapters[0].content,undefined);
      assert.equal((await Manuscript.findById(`${user.id}:${key}`)).chapters[1].content,'不受影响的正文。');
      assert.equal((await owner(path)).data.cloudDrafts.some(row=>row.id===data.id),false);
      assert.equal(await Book.countDocuments({_id:bookId}),1);
    });
    await t.test('expired drafts leave no body or chapter record and cannot resurrect from an offline device', async () => {
      const draft={id:'later-draft',number:3,title:'到期草稿',content:'七天期限的正文。',revision:0};
      assert.equal((await owner(path+'/drafts/'+draft.id,'PUT',draft)).status,200);
      await owner(path+`/trash/drafts/${draft.id}/delete`,'POST',{revision:1});
      const record=await WriterDraft.findOne({draftId:draft.id}), originalKey=record.contentKey;
      await WriterDraft.updateOne({_id:record.id},{$set:{trashUntil:new Date(Date.now()-1000)}});
      assert.equal((await owner(path+`/trash/drafts/${draft.id}/restore`,'POST',{revision:2})).status,410);
      assert.deepEqual(await purgeExpiredWritingTrash(),{purgedDrafts:1,purgedChapters:0});
      await cleanupDraftObjects(storage,new Date(Date.now()+60000));
      assert.equal(await WriterDraft.findById(record.id),null);assert.equal(storage.objects.has(originalKey),false);
      const receipt=await WriterDiscard.findById(record.id).lean();assert.ok(receipt);assert.equal(receipt.title,undefined);assert.equal(receipt.content,undefined);
      const snapshot=(await owner(path)).data;assert.ok(snapshot.removedDraftIds.includes(draft.id));assert.equal(snapshot.trash.length,0);
      assert.equal((await owner(path+'/drafts/'+draft.id,'PUT',draft)).status,410);
      assert.deepEqual(await purgeExpiredWritingTrash(),{purgedDrafts:0,purgedChapters:0});
    });
  } finally {
    app.locals.stopWritingCleanup();configureChapterStorage(undefined);
    await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await repl.stop();
  }
});
