import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {safeHtml} from '../security.js';
import {simplifyReviewText,simplifyReviewHtml} from '../../tools/review-simplify.mjs';

test('local script conversion preserves phrasing, mixed simplified text and repeated conversion',()=>{
 const original='乾隆著作與乾燥的頭髮；想幹什麼？大材小用麽？滑鼠、軟體、網際網路。';
 const converted=simplifyReviewText(original);
 assert.equal(converted,'乾隆著作与干燥的头发；想干什么？大材小用么？滑鼠、软体、网际网路。');
 assert.equal(simplifyReviewText(converted),converted);
 assert.equal(simplifyReviewText('有用么？\uE000 怎麼了？'),'有用么？\uE000 怎么了？');
 assert.equal(simplifyReviewText('原文 https://example.test/繁體?名稱=頭髮 閱讀感受'),'原文 https://example.test/繁體?名稱=頭髮 阅读感受');
});

test('HTML conversion uses phrase context across inline tags and preserves structure, URLs, attributes and entities',()=>{
 const original=safeHtml('<p>乾<strong>隆</strong>的頭髮與著作。<a href="https://example.test/繁體?名稱=頭髮&amp;n=1" title="原作者署名">閱讀原文</a><br />什麼？</p><blockquote>&#x6F22;語 &amp; &lt;標籤&gt;</blockquote>');
 const converted=simplifyReviewHtml(original);
 assert.ok(converted.includes('乾<strong>隆</strong>的头发与著作'));
 assert.ok(converted.includes('汉语 &amp; &lt;标签&gt;'));
 assert.deepEqual(converted.match(/<[^>]*>/g),original.match(/<[^>]*>/g));
 assert.equal(simplifyReviewHtml(converted),converted);
 assert.equal(simplifyReviewHtml('<p>原本就是简体。</p>'),'<p>原本就是简体。</p>');
});
