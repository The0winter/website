import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../storage.mjs';
import {cleanBookForReading, cleanReadingContent, sourceContentHash} from '../../../shared/reading-cleanup.mjs';
import {sourceNoiseLineRule, stripSourceNoiseFragments} from '../../../shared/source-noise.mjs';
import {getChapter} from '../adapters.mjs';
import {formatChapterForExport} from '../titles.mjs';
import {previewBookCleaning} from '../clean-library.mjs';

test('source rules recognize complete obfuscated promotions without normalizing surviving prose', () => {
  const lines = [
    ['www.deqixs.org', '必应搜索“嘚齐小说网”可看本书最新更新章节！'],
    ['www.deqixs.org', 'www.deqixs.org'],
    ['www.deqixs.org', '写到这里，请书友收藏我们的网址：www.deqixs.org看最新无错章节！'],
    ['www.deqixs.org', '更新不易，记得分享，得奇小说网，www.deqixs.org,看最新章节！'],
    ['www.deqixs.org', '请使用必应搜索：得奇小说网免费看最新章节'],
    ['www.deqixs.org', 'ｓuduɡu.ｃｃ首发更新，无错字。看不到地址输入速读谷的拼音后缀.ｃｃ即可进入首发更新站点。'],
    ['www.shudugu.org', '【写到这里我希望读者记一下我们域名101??????.??????】'],
    ['www.shudugu.org', '最⊥新⊥小⊥说⊥在⊥六⊥9⊥⊥书⊥⊥吧⊥⊥首⊥发！'],
    ['www.shudugu.org', '无一错一首一发一内一容一在一一看！'],
    ['www.shudugu.org', 'https://'],
    ['www.shudugu.org', '速-度-谷 最新地址、www.shudugu.org 大家记得收藏，免迷路哦。'],
    ['www.shudugu.org', '【请记住我们的域名 ，如果喜欢本站请分享到Faebk脸】'],
    ['www.shudugu.org', '，笔趣阁高速首发！'],
    ['youyouxs.com', '101看书 101 看书网解无聊，101.超实用 全手打无错站'],
    ['ixdzs8.com', '一秒记住【】，精彩小说无弹窗免费阅读！'],
    ['ixdzs8.com', '请记住本书首发域名：.net。顶点小说手机版阅读网址：'],
    ['xszj.tw', '（ 本書網址：https://xszj.tw/book/123 ）'],
    ['d.80qishu.com', '&amp;amp;amp;lt;ahref=http://.&amp;amp;amp;gt;起点中文网.欢迎广大书友光临阅读，最新、最快、最火的连载作品尽在起点原创！&amp;lt;/a&amp;gt;'],
  ];
  for (const [host, line] of lines) {
    assert.ok(sourceNoiseLineRule(line, host), line);
    assert.equal(sourceNoiseLineRule(line, 'unverified.test'), null);
    assert.equal(cleanReadingContent(`　前文ＡＢＣ。\n${line}\n　后文。`, {link: `https://${host}/1`}).content, '　前文ＡＢＣ。\n　后文。');
  }
});

test('confirmed inline watermarks preserve every surrounding character and paragraph break', () => {
  const cases = [
    ['www.kanunu8.com', 'http://www.21coming.com'],
    ['ixdzs8.com', '(狂_人_小_说_网-www.xiaoshuo.kr)'],
    ['ixdzs8.com', '&amp;长&amp;风&amp;文学{www}.{cf}{wx}.{net}'],
    ['ixdzs8.com', '【本章节首发-爱-有-声-小说网,请记住网址】'],
    ['www.shudugu.org', '一秒记住【中文网】，为您提供高速文字首发。&nbsp&nbsp&nbsp&nbsp'],
    ['www.deqixs.org', '全文字手打www.deq\u200bi\u200cx\ufeffs.org'],
    ['www.deqixs.org', '全文字手打w<span class="txt">ww</span>.de<span class="txt">qixs</span>.<span class="txt">o</span>rg'],
    ['www.shudugu.org', '记住我们的域名：，精彩随时可读。'],
    ['www.shudugu.org', '【记住本站域名超便捷，随时看】'],
  ];
  for (const [host, fragment] of cases) {
    const original = `　“前文${fragment}后文。”\n　下一段。`;
    const result = cleanReadingContent(original, {link: `https://${host}/1`});
    assert.equal(result.content, '　“前文后文。”\n　下一段。', fragment);
    assert.equal(result.removed.filter(r => r.reason.startsWith('source-noise:')).map(r => r.text).join(''), fragment);
    assert.equal(stripSourceNoiseFragments(original, 'unverified.test').text, original);
  }
});

test('dialogue URLs, author notes, chapter dividers and missing-content notices survive', () => {
  const lines = ['他说：“网址是 www.example.com，记住后再回来。”', '注意：本书首发网站是起点，所以，本活动只针对起点月票。', '具体编号可以从月票纪念册查询。', '-----------------', '“轰隆隆......”', '正在手打中，请稍等片刻，内容更新后，请重新刷新页面，即可获取最新更新！'];
  const original = lines.join('\n');
  for (const host of ['www.shudugu.org','www.deqixs.org','ixdzs8.com','xszj.tw','www.kanunu8.com']) assert.equal(cleanReadingContent(original, {link:`https://${host}/1`}).content, original);
  assert.ok(sourceNoiseLineRule('一秒记住【网','www.shudugu.org',{line:1}));
  assert.equal(sourceNoiseLineRule('一秒记住【网','www.shudugu.org',{line:30}),null);
  assert.equal(cleanReadingContent('一秒记住【网',{link:'https://www.shudugu.org/1'}).content,'一秒记住【网');
  const note='今天两更，感谢支持！';
  assert.equal(cleanReadingContent('前文。\n后文。(首发、域名(请记住_三',{link:'https://www.shudugu.org/1'}).content,'前文。\n后文。');
  assert.equal(cleanReadingContent(note+'(未完待续，如欲知后事如何，请登陆www.qidian.com，章节更多，支持作者，支持正版阅读！)',{link:'https://ixdzs8.com/1'}).content,note);
});

test('version 1 evidence remains authenticated while a later cleanup records only its new changes', () => {
  const content='正文甲。\n【写到这里我希望读者记一下我们域名101kan.com】\n正文乙。';
  const sourceHash=hash('第一章\n'+content);
  const chapter={title:'第一章',chapter_number:1,link:'https://www.shudugu.org/1',content,
    readingCleanup:{version:1,sourceHash,contentHash:hash(content),changes:[{reason:'opening-title',line:1,hash:hash('第一章'),characters:3}]}};
  const book={title:'测试书',author:'测试作者',chapters:[chapter]};
  const preview=previewBookCleaning(book),next=preview.book;
  assert.equal(next.chapters[0].readingCleanup.version,2);
  assert.equal(sourceContentHash(next.chapters[0]),sourceHash);
  assert.deepEqual(preview.changes[0].reasons,['source-noise:mirror-domain-reminder']);
  assert.deepEqual(cleanBookForReading(next),next);
  assert.throws(()=>sourceContentHash({...chapter,content:'外部修改'}),/不一致/);
  assert.throws(()=>sourceContentHash({...chapter,readingCleanup:{...chapter.readingCleanup,version:3}}),/不一致/);
});

test('HTML acquisition retains raw evidence and cleans the exported chapter after pagination', async () => {
  const urls=['https://www.deqixs.org/1/1.html','https://www.deqixs.org/1/1-2.html'];
  const ad='必应搜索“嘚齐小说网”可看本书最新更新章节！';
  const pages=new Map([[urls[0],`<h1>第一章</h1><div class="con">正文甲。<p>${ad}</p></div><a class="next" href="${urls[1]}">下一页</a>`],[urls[1],'<h1>第一章</h1><div class="con">正文乙。</div>']]);
  const spec={chapter:{title:'h1',content:'.con',next:'.next'},catalog:{}};
  const client={assertUrl:url=>url,get:async url=>({url,body:Buffer.from(pages.get(url)),contentType:'text/html;charset=utf-8',hash:hash(pages.get(url))})};
  const raw=await getChapter(spec,{link:urls[0],title:'第一章',chapter_number:1},new Set([urls[0]]),client);
  assert.ok(raw.content.includes(ad));assert.equal(raw.provenance.length,2);
  const exported=formatChapterForExport(raw);assert.equal(exported.content,'正文甲。\n正文乙。');
  assert.equal(sourceContentHash(exported),hash(raw.content));assert.deepEqual(exported.provenance,raw.provenance);
});
