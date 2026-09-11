import fs from 'node:fs';
import crypto from 'node:crypto';
import mongoose from '../server/node_modules/mongoose/index.js';
import {MongoMemoryReplSet} from '../server/node_modules/mongodb-memory-server/index.js';
import {chromium} from '../web-next/node_modules/@playwright/test/index.mjs';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import Book from '../server/models/Book.js';
import Chapter from '../server/models/Chapter.js';

const repl = await MongoMemoryReplSet.create({binary: {version: '7.0.40'}, replSet: {count: 1}});
await mongoose.connect(repl.getUri('test1_test'), {autoIndex: false});
let server, browser;
const results = [];
try {
  await Chapter.createIndexes();
  const books = [];
  for (const total of [375, 10000]) {
    const book = await Book.create({title: `目录测试 ${total}`, writeVersion: 0});
    const chapters = await Chapter.insertMany(Array.from({length: total}, (_, index) => ({bookId: book.id, chapter_number: index + 1, title: `第${index + 1}章 山间来信，新的旅程开始了（合成目录测试）`, content: '合成正文。'})));
    books.push({id: book.id, total, anchor: chapters[Math.floor(total * .8)].id});
  }
  const app = createApp(readConfig({APP_ENV: 'test', MONGO_URI: repl.getUri('test1_test'), JWT_SECRET: crypto.randomBytes(48).toString('hex')}));
  app.get('/', (_req, res) => res.send('<!doctype html><title>Catalog benchmark</title>'));
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  browser = await chromium.launch({channel: 'chrome', headless: true});
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', {cacheDisabled: true});
  for (const profile of [{name: 'broadband', latency: 80, bytes: 1024 * 1024}, {name: 'slow-mobile', latency: 250, bytes: 64 * 1024}]) {
    await cdp.send('Network.emulateNetworkConditions', {offline: false, latency: profile.latency, downloadThroughput: profile.bytes, uploadThroughput: profile.bytes});
    if (process.argv.includes('--bulk')) {
    const book = books[1];
    for (const size of [512, 1024, 2048]) {
      const result = await page.evaluate(async ({book, size}) => {
        const start = performance.now(); let offset = 0, bytes = 0, requests = 0;
        while (offset < book.total) {
          const response = await fetch(`/api/books/${book.id}/catalog?offset=${offset}&limit=${size}`, {cache: 'no-store'});
          const text = await response.text(), data = JSON.parse(text);
          if (!response.ok || !data.rows.length) throw Error(text);
          bytes += new TextEncoder().encode(text).length; requests++; offset += data.rows.length;
        }
        return {completeMs: Math.round(performance.now() - start), bytes, requests};
      }, {book, size});
      results.push({profile: profile.name, size, ...result}); console.log(JSON.stringify(results.at(-1)));
    }
      } else {
    for (const book of books) for (const size of [128, 256, 512, 1024, 2048]) {
      const samples = [];
      for (let round = 0; round < 3; round++) samples.push(await page.evaluate(async ({book, size}) => {
        const start = performance.now(), response = await fetch(`/api/books/${book.id}/catalog?anchor=${book.anchor}&limit=${size}`);
        const headers = performance.now(), text = await response.text(), data = JSON.parse(text);
        if (!response.ok || !data.rows.some(row => row.id === book.anchor)) throw Error(text);
        return {ms: performance.now() - start, ttfb: headers - start, bytes: new TextEncoder().encode(text).length, count: data.rows.length};
      }, {book, size}));
      const row = {profile: profile.name, total: book.total, size, medianMs: Math.round(samples.map(s => s.ms).sort((a, b) => a - b)[1]), bytes: samples[0].bytes, rows: samples[0].count};
      results.push(row); console.log(JSON.stringify(row));
    }
    const book = books[1];
    const baseline = await page.evaluate(async book => {
      const start = performance.now(); let next = 2, bytes = 0, targetMs = null;
      const pages = [];
      const load = async number => {const response = await fetch(`/api/books/${book.id}/chapters?page=${number}&limit=200&benchmark=${Date.now()}`, {cache: 'no-store'}), text = await response.text(); bytes += new TextEncoder().encode(text).length; pages[number - 1] = JSON.parse(text); let prefix = 0; while (pages[prefix]) prefix++; if (targetMs === null && pages.slice(0, prefix).some(rows => rows.some(row => row.id === book.anchor))) targetMs = performance.now() - start;};
      await load(1);
      await Promise.all(Array.from({length: 3}, async () => {while (next <= Math.ceil(book.total / 200)) await load(next++);}));
      return {targetMs: Math.round(targetMs), completeMs: Math.round(performance.now() - start), bytes};
    }, book);
    results.push({profile: profile.name, strategy: 'old-200x3', total: book.total, ...baseline}); console.log(JSON.stringify(results.at(-1)));
      }
  }
  fs.writeFileSync(process.argv.includes('--bulk') ? 'artifacts/catalog-bulk-benchmark.json' : 'artifacts/catalog-strategy-benchmark.json', JSON.stringify(results, null, 2));
} finally {await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await repl.stop();}
