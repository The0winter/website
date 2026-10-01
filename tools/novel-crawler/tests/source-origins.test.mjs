import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {makeClient} from '../http.mjs';
import {sourceOrigins, canonicalSourceUrl} from '../source-origins.mjs';
import {getCatalog, getChapter} from '../adapters.mjs';
import {loadSites, normalizeWebsite, specForBook} from '../desktop/sources.mjs';
import {extractionHash, jobId} from '../core.mjs';

test('reviewed source origin preserves identity and never grants unrelated hosts or ports', () => {
  const origins = sourceOrigins(['www.shudugu.org']);
  const old = 'https://www.shudugu.org/79/123_2.html?a=1';
  const moved = 'https://www.suduguu.com/79/123_2.html?a=1';
  assert.equal(origins.transport(old), moved);
  assert.equal(origins.canonical(moved), old);
  for (const url of ['https://www.suduguu.com:444/79/', 'http://www.suduguu.com/79/', 'https://www.suduguu.com.evil.test/79/', 'https://user@www.suduguu.com/79/']) assert.equal(origins.canonical(url), url);
  assert.equal(sourceOrigins(['unrelated.test']).canonical(moved), moved);
  assert.equal(canonicalSourceUrl(moved), old);
  const sites=loadSites().sites, book={title:'1984：从破产川菜馆开始',author:'轻语江湖'};
  const a=specForBook({...book,url:'https://www.shudugu.org/79/'},sites);
  const b=specForBook({...book,url:'https://www.suduguu.com/79/'},sites);
  assert.equal(normalizeWebsite('https://www.suduguu.com/79/'),'https://www.shudugu.org/79/');
  assert.equal(jobId(a),jobId(b)); assert.equal(extractionHash(a),extractionHash(b));
});

test('moved origin keeps catalog and paginated chapter links while recording actual response URLs', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'source-origin-'));
  let destination;
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    if(req.url==='/book')return res.end(`<h1>迁移测试</h1><b>作者</b><nav><a href="${destination}/chapter">第一章 起点</a></nav>`);
    if(req.url==='/chapter')return res.end(`<h1>第一章 起点</h1><article>原来的第一页正文</article><a class="next" href="${destination}/chapter_2">下一页</a>`);
    if(req.url==='/chapter_2')return res.end('<h1>第一章 起点</h1><article>完整的第二页正文</article>');
    if(req.url==='/changed'){res.writeHead(302,{Location:destination+'/different'});return res.end();}
    if(req.url==='/external'){res.writeHead(302,{Location:'https://unconfigured.test/book'});return res.end();}
    res.end('<h1>第一章 起点</h1><article>其他页面不能当作原章</article>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  destination=`http://127.0.0.1:${server.address().port}`;
  const origin='https://old.example';
  const client=makeClient({cacheDir:path.join(root,'cache'),allowedHosts:['old.example'],delayMs:1,retries:0,originMigrations:[{canonical:origin,transport:destination}]});
  t.after(async()=>{await client.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(root),os.tmpdir());assert.match(path.basename(root),/^source-origin-/);fs.rmSync(root,{recursive:true,force:true});});
  const spec={title:'迁移测试',author:'作者',sourceUrl:origin+'/book',metadata:{title:'h1',author:'b'},catalog:{links:'nav a'},chapter:{title:'h1',content:'article',next:'a.next'}};
  const {catalog}=await getCatalog(spec,client);
  assert.equal(catalog[0].link,origin+'/chapter');
  const chapter=await getChapter(spec,catalog[0],new Set(catalog.map(c=>c.link)),client);
  assert.equal(chapter.content,'原来的第一页正文\n完整的第二页正文');
  assert.deepEqual(chapter.provenance.map(p=>[p.url,p.responseUrl]),[[origin+'/chapter',destination+'/chapter'],[origin+'/chapter_2',destination+'/chapter_2']]);
  const cached=await client.get(origin+'/chapter');
  assert.equal(cached.url,origin+'/chapter');assert.equal(cached.responseUrl,destination+'/chapter');
  assert.equal(client.stats.cacheHits,1);
  const rendered=await getChapter({...spec,chapter:{...spec.chapter,transport:'browser'}},catalog[0],new Set(catalog.map(c=>c.link)),client);
  assert.equal(rendered.content,chapter.content);
  assert.deepEqual(rendered.provenance.map(p=>p.responseUrl),chapter.provenance.map(p=>p.responseUrl));
  await assert.rejects(getChapter(spec,{...catalog[0],link:origin+'/changed'},new Set(),client),/页面发生跳转/);
  await assert.rejects(client.get(origin+'/external'),/域名范围/);
  await assert.rejects(getCatalog({...spec,title:'错误作品'},client),/作品身份不匹配/);
  assert.throws(()=>client.assertUrl('http://other.test/chapter'),/域名范围/);
});
