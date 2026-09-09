// This entry deliberately never loads existing .env files or old data.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { spawn } from 'node:child_process';
import { createApp } from './app.js';
import { readConfig } from './config.js';
import Book from './models/Book.js';
import Chapter from './models/Chapter.js';
import User from './models/User.js';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import {capturedMail} from './utils/sendEmail.js';

const repl = await MongoMemoryReplSet.create({ binary: { version: '7.0.40' }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ port: 27028 }] });
Object.assign(process.env, { APP_ENV: 'development', MONGO_URI: repl.getUri('test1_dev'), JWT_SECRET: crypto.randomBytes(48).toString('hex'), EXTERNAL_SERVICES: 'disabled', MAIL_MODE: 'capture', INTERNAL_API_SECRET:crypto.randomBytes(32).toString('hex') });
await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, serverSelectionTimeoutMS: 5000 });
for (const model of Object.values(mongoose.models)) await model.createIndexes();
const user = await User.create({ _id: '000000000000000000000001', username: '隔离作者', email: 'reader@example.test', password: await bcrypt.hash('Local-test-12345', 10) });
await User.create({username:'隔离管理员',email:'admin@example.test',password:await bcrypt.hash('Admin-test-12345',10),role:'admin'});
fs.mkdirSync('.runtime',{recursive:true});
fs.writeFileSync('.runtime/development-mail.json','[]',{mode:0o600});
let previousMail='[]';
const captureTimer=setInterval(()=>{const current=JSON.stringify(capturedMail);if(current!==previousMail){fs.writeFileSync('.runtime/development-mail.json',current,{mode:0o600});previousMail=current;}},250);
captureTimer.unref();
const book = await Book.create({ _id: '000000000000000000000101', title: '隔离测试：山海行记', author: user.username, author_id: user._id, description: '确定性合成内容，仅供本地回归。', category: '玄幻' });
await Chapter.insertMany(Array.from({ length: 12 }, (_, i) => ({ _id: (257 + i).toString(16).padStart(24, '0'), bookId: book._id, title: `第${i + 1}章 山间来信`, chapter_number: i + 1, content: ('清晨的风穿过山林，行者打开一封来自远方的信。\n\n这是用于验证排版与翻页的合成正文。\n\n').repeat(30), word_count: 1500 })));
const server = createApp(readConfig()).listen(5000, '127.0.0.1');
const frontend = spawn(process.execPath, ['web-next/node_modules/next/dist/bin/next', 'dev', 'web-next', '--hostname', '127.0.0.1'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, INTERNAL_API_URL: 'http://127.0.0.1:5000/api', NEXT_PUBLIC_API_URL: '', NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000', NEXT_PUBLIC_EXTERNAL_SERVICES: 'disabled' } });
console.log('Synthetic development: http://127.0.0.1:3000; reader@example.test / Local-test-12345');
let stopping = false;
async function stop() { if (stopping) return; stopping = true;clearInterval(captureTimer); frontend.kill(); server.close(); await mongoose.disconnect(); await repl.stop(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
frontend.on('exit', stop);
