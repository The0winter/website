import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanReviewText,renderReviewText} from '../../tools/review-cleanup.mjs';
import {reviewText,reviewContentProblems,assertCollectedReviewQuality} from '../../shared/review-quality.mjs';

test('known source controls are removed without deleting criticism, quotations or citations',()=>{
 const body='这本书的节奏并不好。\n\n他说：“查看原文才知道。”\n注[1]：另一部作品。';
 const d=cleanReviewText(body+'\n    <div','https://book.douban.com/review/1/');
 assert.equal(d.text,body);
 const c=cleanReviewText(body+'\n本网站有部分内容来自互联网，声明。\n"+data.recommend.article[i].description+"','https://www.chinawriter.com.cn/n1/1.html');
 assert.equal(c.text,body);
 assert.equal(cleanReviewText('我不同意“本网站有部分内容来自互联网”的说法。','https://www.chinawriter.com.cn/1').removed.length,0);
 assert.equal(cleanReviewText('正文。❤️12\n_收录于:2026-09-01_','https://www.qidiantu.com/info/1').text,'正文。');
 const p=cleanReviewText('作者 A\n看板 CFantasy\n標題 測試\n時間 Today\n\n引述：\n> 对方的原话。\n\n我的分析。\n--\n※ 發信站: 批踢踢\n推 other : 他人的评论','https://www.ptt.cc/bbs/X/1.html');
 assert.equal(p.text,'引述：\n> 对方的原话。\n\n我的分析。');
});

test('format conversion decodes once, preserves text and emits only safe links and markup',()=>{
 const first=cleanReviewText('&#160;第一段<br/>第二段\n\n### 小标题\n\n**重点** [原文](https://example.test/a?x=1&y=2)','https://tieba.baidu.com/p/1');
 const html=renderReviewText(first.text);
 assert.equal(reviewText(html),'第一段\n第二段\n小标题\n重点 原文');
 assert.ok(html.includes('<h3>小标题</h3>'));
 assert.ok(html.includes('<strong>重点</strong>'));
 assert.ok(!html.includes('<script'));
 assert.deepEqual(reviewContentProblems(html),[]);
 assert.equal(cleanReviewText(first.text,'https://tieba.baidu.com/p/1').text,first.text);
});

test('import quality rejects access pages, escaped fragments, scripts, raw markup and mislabeled evidence',()=>{
 const article={source:{kind:'original'},content:'<p>完整合成书评。</p>'};
 assert.doesNotThrow(()=>assertCollectedReviewQuality(article));
 for(const bad of ['很抱歉，你需要登录才能继续浏览','(ERROR:15)','&lt;div','zbhtml+=data.videolive','返回搜狐，查看更多','&amp;#160;','[原文](https://example.test/)'])assert.throws(()=>assertCollectedReviewQuality({...article,content:'<p>'+bad+'</p>'}),/检查/);
 assert.throws(()=>assertCollectedReviewQuality({...article,source:{}}),/内容类型/);
 assert.throws(()=>assertCollectedReviewQuality({...article,evidence:{isExcerpt:true}}),/核验片段/);
 assert.throws(()=>assertCollectedReviewQuality({...article,evidence:{summaryType:'editorial_reading_guide'}}),/导读/);
 const cut={...article,content:'<p>'+'字'.repeat(500)+'</p>'};
 assert.throws(()=>assertCollectedReviewQuality(cut),/定长截断/);
 assert.doesNotThrow(()=>assertCollectedReviewQuality({...cut,source:{kind:'excerpt'}}));
 assert.doesNotThrow(()=>assertCollectedReviewQuality({...cut,evidence:{complete:true}}));
});
