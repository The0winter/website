import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cleanReadingContent, cleanBookForReading, sourceContentHash} from '../../../shared/reading-cleanup.mjs';
import {prepareImport} from '../../../infra/import-plan.mjs';
import {buildCatalogVolumes} from '../../../shared/catalog-volumes.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');

test('observed signatures and heading punctuation are removed, prose and paragraph identity remain', () => {
  const prose = '他喊道：“请记住我说的话：不要乱删广告两个字。”';
  const original = `第194章 继续抓!\n${prose}\n（请记住101??????.??????网站，观看最快的章节更新）\n：\n第二段正文。\n(本章完)`;
  const b={title:'测试',author:'作者',sourceUrl:'https://www.deqixs.org/1/',chapters:[{title:'第194章 继续抓',chapter_number:1,content:original,link:'https://www.deqixs.org/1/2.html'}]};
  const cleaned=cleanBookForReading(b);
  assert.equal(cleaned.chapters[0].content,`${prose}\n第二段正文。`);
  assert.equal(sourceContentHash(cleaned.chapters[0]),sha(original));
  assert.deepEqual(cleanBookForReading(cleaned),cleaned);
  assert.equal(b.chapters[0].content,original);
  assert.throws(()=>sourceContentHash({...cleaned.chapters[0],content:'篡改正文'}),/不一致/);
  assert.equal(cleanReadingContent('他说：\n：\n“是的。”',{link:'https://unknown.test/1'}).content,'他说：\n：\n“是的。”');
  assert.equal(cleanReadingContent('序言',{title:'序言'}).content,'序言');
  for(const advertisement of ['【记住本站域名www.???】','请记住本书首发域名：www.example.test。手机版阅读网址：m.example.test','记住这个名字：可乐小说。记住这个域名：。好书不迷路。','求书、催更、报错 + 官方纸飞机（电报群）：https://t.me/deqixs']) {
    assert.equal(cleanReadingContent(`第一段。\n${advertisement}\n第二段。`).content,'第一段。\n第二段。');
  }
  assert.equal(cleanReadingContent('他在纸上写下：记住本站域名。\n请大家记住我，下章见。').removed.length,0);
});

test('volume runs survive import, chapter ordinals and notices are retained', () => {
  const b={title:'测试',author:'作者',sourceUrl:'https://example.test/book',chapters:[
    {chapter_number:1,title:'序言',content:'前言正文'},
    {chapter_number:2,title:'第一章 初见',sourceSection:'第一卷 春',content:'独立的正文第一章'},
    {chapter_number:3,title:'请假条',sourceSection:'第一卷 春',content:'今天有事请假。'},
    {chapter_number:4,title:'第一章 再见',sourceSection:'第二卷 夏',content:'另一个卷的不同正文'},
  ]};
  const cleaned=cleanBookForReading(b),imported=prepareImport(cleaned)[0].chapters;
  assert.deepEqual(imported.map(c=>c.chapter_number),[1,2,3,4]);
  assert.deepEqual(imported.map(c=>c.volume_number),[undefined,1,1,2]);
  assert.deepEqual(buildCatalogVolumes(imported).map(v=>[v.title,v.count]),[['',1],['第一卷 春',2],['第二卷 夏',1]]);
  assert.throws(()=>prepareImport({...b,chapters:[{...b.chapters[0],volume_number:0}]}),/卷序号/);
});
