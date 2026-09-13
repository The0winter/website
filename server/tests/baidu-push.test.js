import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPublicUrls, submitBatch, SITE} from '../baidu_push.js';

test('Baidu submits content URLs from sitemap partitions, not the partition addresses', async () => {
  const docs = {
    [SITE + '/sitemap.xml']: `<sitemapindex><sitemap><loc>${SITE}/sitemaps/static.xml</loc></sitemap></sitemapindex>`,
    [SITE + '/sitemaps/static.xml']: `<urlset><url><loc>${SITE}/</loc></url><url><loc>${SITE}/ranking</loc></url><url><loc>${SITE}/</loc></url></urlset>`,
  };
  const urls = await collectPublicUrls(async url => new Response(docs[url]));
  assert.deepEqual(urls, [SITE + '/', SITE + '/ranking']);
});

test('foreign hosts, private paths and unavailable partitions stop collection', async () => {
  for (const target of ['https://www.jiutianxiaoshuo.com/', 'https://other.example/', SITE + '/writer', SITE + '/?token=private']) {
    await assert.rejects(collectPublicUrls(async () => new Response(`<urlset><url><loc>${target}</loc></url></urlset>`)));
  }
  await assert.rejects(collectPublicUrls(async () => new Response('Unavailable', {status: 503})));
});

test('quota failures and unexplained partial successes cannot advance history', async () => {
  await assert.rejects(submitBatch([SITE + '/'], 'test-token', async () => new Response('quota', {status: 429})));
  await assert.rejects(submitBatch([SITE + '/', SITE + '/ranking'], 'test-token', async () => Response.json({success: 1, remain: 0})));
  const result = await submitBatch([SITE + '/', SITE + '/ranking'], 'test-token', async (_url, options) => {
    assert.equal(options.body, SITE + '/\n' + SITE + '/ranking');
    return Response.json({success: 1, remain: 9, not_valid: [SITE + '/ranking']});
  });
  assert.deepEqual(result.accepted, [SITE + '/']);
  assert.deepEqual(result.rejected, [SITE + '/ranking']);
});
