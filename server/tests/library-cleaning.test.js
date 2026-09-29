import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import ParagraphComment from '../models/ParagraphComment.js';
import {inspectCleaningBook, reviseCleaningBatch, restoreCleaningBackup} from '../services/library-cleaning.js';
import {readerParagraphs} from '../../shared/reader-paragraphs.mjs';
import {validateChapter} from '../services/content.js';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');

test('maintenance preserves IDs, dates, annotations and original objects, checks concurrency and restores safely', async () => {
  const db=await TestDatabase.create();await mongoose.connect(db.getUri(),{autoIndex:false,autoCreate:false});
  const backups=[],objects=new Map();let failStorage=false;
  const deps={mongoose,Book,Chapter,ParagraphComment,readBody:async c=>c.content??objects.get(c.contentKey),storeBodies:async rows=>{
    if(failStorage)throw Error('storage unavailable');
    return rows.map(c=>{const contentSha256=sha(c.content),contentKey=`chapters/sha256/${contentSha256}.txt`;objects.set(contentKey,c.content);return {...c,content:undefined,contentSha256,contentKey};});
  },writeBackup:async b=>{backups.push(b);return '/backup/'+backups.length;}};
  try {
    const book=await Book.create({title:'清洗测试',author:'测试作者',sourceUrl:'https://example.test/book',importManaged:true});
    const chapter=await Chapter.create({bookId:book._id,title:'第1章 初见',chapter_number:1,content:'第1章 初见!\n保留这段正文。\n：',word_count:24});
    const para=readerParagraphs(chapter.content,chapter.title,1).find(p=>p.text==='保留这段正文。');
    const comment=await ParagraphComment.create({book:book._id,chapter:chapter._id,user:new mongoose.Types.ObjectId(),paragraphKey:para.key,paragraphText:para.text,content:'读者评论',requestId:'cleanup-test'});
    const identity={title:book.title,author:book.author,sourceUrl:book.sourceUrl};
    const remote=await inspectCleaningBook(identity,deps);
    const job={mode:'revise',runId:'test-cleanup',...identity,bookId:remote.bookId,token:remote.token,chapters:[{id:String(chapter._id),title:chapter.title,number:1,beforeHash:sha(chapter.content),beforeVolume:{},content:'保留这段正文。',volume_title:'第一卷 初见',volume_number:1}]};
    assert.equal((await reviseCleaningBatch({...job,preview:true},deps)).chapters,1);assert.equal(backups.length,0);
    failStorage=true;await assert.rejects(reviseCleaningBatch(job,deps),/storage unavailable/);assert.equal((await Chapter.findById(chapter._id).lean()).content,chapter.content);failStorage=false;
    const result=await reviseCleaningBatch(job,deps);assert.equal(result.updated,1);
    const after=await Chapter.findById(chapter._id).lean();assert.equal(after.chapter_number,1);assert.equal(after.title,chapter.title);assert.equal(after.contentSha256,sha('保留这段正文。'));assert.equal(+after.updatedAt,+chapter.updatedAt);
    assert.equal(+(await Book.findById(book._id)).updatedAt,+book.updatedAt);
    assert.equal((await ParagraphComment.findById(comment._id)).paragraphKey,para.key);
    await assert.rejects(reviseCleaningBatch(job,deps),/版本/);
    await restoreCleaningBackup(backups.at(-1),deps);assert.equal((await Chapter.findById(chapter._id)).content,chapter.content);
    await assert.rejects(restoreCleaningBackup(backups.at(-1),deps),/新的修改/);
    assert.deepEqual(validateChapter({title:'章',chapter_number:1,content:'文',volume_title:'卷',volume_number:2}),{title:'章',chapter_number:1,content:'文',word_count:1,volume_title:'卷',volume_number:2});
  } finally {await mongoose.disconnect();await db.stop();}
});
