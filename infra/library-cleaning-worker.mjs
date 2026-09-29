import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';
import {createInterface} from 'node:readline';
import mongoose from '../server/node_modules/mongoose/index.js';
import {connectDatabase} from '../server/database/index.js';
import Book from '../server/models/Book.js';
import Chapter from '../server/models/Chapter.js';
import ParagraphComment from '../server/models/ParagraphComment.js';
import {readChapterBody, storeChapterBodies} from '../server/services/chapter-storage.js';
import {inspectCleaningBook, reviseCleaningBatch, restoreCleaningBackup} from '../server/services/library-cleaning.js';
const backupRoot = '/srv/test1/backups/reading-cleanup';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
process.chdir(fs.realpathSync(new URL('../server/', import.meta.url)));
const models = {mongoose, Book, Chapter, ParagraphComment, readBody: readChapterBody, storeBodies: storeChapterBodies};
function writeBackup(record) {
  const bytes = Buffer.from(JSON.stringify(record)), sha = digest(bytes);
  const dir = path.join(backupRoot, record.runId), file = path.join(dir, sha + '.json.gz');
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  if (!fs.existsSync(file)) fs.writeFileSync(file, gzipSync(bytes), {flag: 'wx', mode: 0o600});
  if (digest(gunzipSync(fs.readFileSync(file))) !== sha) throw Error('恢复记录回读校验失败');
  return file;
}
let connected = false;
try {
  for await (const line of createInterface({input: process.stdin, crlfDelay: Infinity})) {
    let message;
    try {
      if (line.length > 8 * 1024 * 1024) throw Error('请求过大');
      message = JSON.parse(line);
      if (message.protocol !== 1 || !Number.isSafeInteger(message.id)) throw Error('协议无效');
      const job = message.job;
      if (!connected) { await connectDatabase(undefined,{monitorCommands:false}); connected = true; }
      let result;
      if (job.mode === 'inventory') result = {books: await Book.find({importManaged:true,deletedAt:null,author_id:null}).select('_id title author sourceUrl').lean()};
      else if (job.mode === 'inspect') result = await inspectCleaningBook(job, models);
      else if (job.mode === 'revise') {
        if (process.env.WRITE_MODE !== 'readwrite') throw Error('网站当前不允许修订');
        result = await reviseCleaningBatch(job, {...models, writeBackup});
      } else if (job.mode === 'restore') {
        if (process.env.WRITE_MODE !== 'readwrite' || !/^\/[a-zA-Z0-9/_-]+\/[a-f0-9]{64}\.json\.gz$/u.test(job.backupFile || '') || !job.backupFile.startsWith(backupRoot + '/')) throw Error('恢复路径无效或网站只读');
        const bytes = gunzipSync(fs.readFileSync(job.backupFile));
        if (digest(bytes) !== path.basename(job.backupFile, '.json.gz')) throw Error('恢复清单校验失败');
        result = await restoreCleaningBackup(JSON.parse(bytes), models);
      } else throw Error('未知清理操作');
      console.log(JSON.stringify({protocol:1,id:message.id,type:'result',result}));
    } catch (error) {
      console.log(JSON.stringify({protocol:1,id:message?.id,type:'error',error:error.publicMessage || '书库修订失败；原始恢复记录保留，请检查服务与日志'}));
    }
  }
} finally { await mongoose.disconnect(); }
