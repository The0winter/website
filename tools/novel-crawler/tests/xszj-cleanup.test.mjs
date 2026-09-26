import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {loadSites} from '../desktop/sources.mjs';
import {cleanHtml} from '../adapters.mjs';

test('xszj removes only the complete observed footer and preserves similar prose', () => {
  const rules = loadSites().sites.find(site => site.id === 'xszj').spec.chapter;
  const prose = '他出版过一本小說集，也在故事里说“请分享给更多书友”。';
  const footer = '<p>小說集為廣大書友們提供好看的網路小說全文免費線上閱讀，如果您喜歡本站，請分享給更多的書友們！</p><p>如果您覺得《送行》小說很精彩的話，請貼上以下網址分享給您的好友，謝謝支援！</p><p>（ 本書網址：https://xszj.tw/book/89529 ）</p>';
  const extract = html => cleanHtml(load(`<div id="reading-body">${html}</div>`), rules.content, rules.remove, rules.removeText);
  assert.equal(extract(`<p>${prose}</p>${footer}`), prose);
  assert.ok(extract(`<p>${prose}</p>${footer}<p>后面还有正文。</p>`).includes('本書網址'));
  assert.equal(extract('<p>正文结束。</p><p>(完)shocking製作</p>'), '正文结束。\n(完)');
  assert.equal(extract('<p>他说shocking製作只是署名。</p>'), '他说shocking製作只是署名。');
});
