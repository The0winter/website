// Preview current public sitemap URLs; pass --apply to notify IndexNow participants.
// This is a recovery/bulk-update command, not a recurring full-site submission job.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const site = 'https://jiutianxiaoshuo.com';
const endpoint = 'https://api.indexnow.org/indexnow';
const keyFile = new URL('../web-next/public/8493abc32948jiutianxiaoshuo.txt', import.meta.url);
const apply = process.argv.includes('--apply');
assert.ok(process.argv.slice(2).every(arg => arg === '--apply'), 'Only --apply is supported');
const key = (await readFile(keyFile, 'utf8')).trim();
assert.match(key, /^[a-zA-Z0-9-]{8,128}$/);
const keyLocation = `${site}/${key}.txt`;

async function get(url) {
  const response = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(30000)});
  assert.equal(response.status, 200, `${url}: HTTP ${response.status}`);
  return response.text();
}

function locations(xml) {
  assert.ok(!/<!DOCTYPE|<!ENTITY/i.test(xml), 'Unexpected sitemap declaration');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1].replaceAll('&amp;', '&'));
}

const robots = await get(site + '/robots.txt');
assert.match(robots, /^Allow: \/$/m);
assert.doesNotMatch(robots, /^Disallow: \/$/m);
assert.equal((await get(keyLocation)).trim(), key, 'The public verification file must match');
const index = await get(site + '/sitemap.xml');
assert.match(index, /<sitemapindex\b/);
const maps = locations(index);
assert.ok(maps.length > 0 && maps.length <= 1000, 'Unexpected sitemap count');
const urls = new Set();
for (const map of new Set(maps)) {
  assert.ok(map.startsWith(site + '/sitemaps/') && !/[?#]/.test(map), 'Unexpected sitemap URL');
  const xml = await get(map);
  assert.match(xml, /<urlset\b/);
  const entries = locations(xml);
  assert.ok(entries.length <= 50000, 'Sitemap URL limit');
  for (const url of entries) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, site, 'Only this website may be submitted');
    assert.ok(!parsed.search && !parsed.hash && !parsed.username && !parsed.password);
    assert.match(parsed.pathname, /^(?:\/|\/(?:ranking|forum)|\/book\/[a-f0-9]{24}(?:\/[a-f0-9]{24})?|\/author\/[a-f0-9]{24})$/, 'Only known public content routes may be submitted');
    urls.add(url);
  }
}
assert.ok(urls.size > 0 && urls.size <= 200000, 'Unexpected total URL count; review the sitemap before expanding the limit');
const list = [...urls];
const report = {mode: apply ? 'apply' : 'preview', site, endpoint, checkedAt: new Date().toISOString(), sitemaps: maps.length, urls: list.length, sample: list.slice(0, 5), batches: []};
if (apply) {
  for (let offset = 0; offset < list.length; offset += 10000) {
    const batch = list.slice(offset, offset + 10000);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json; charset=utf-8'},
      body: JSON.stringify({host: new URL(site).host, key, keyLocation, urlList: batch}),
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    const status = response.status;
    await response.text();
    report.batches.push({urls: batch.length, status, keyValidationPending: status === 202});
    if (status !== 200 && status !== 202) {
      console.error(JSON.stringify(report));
      throw new Error(`IndexNow HTTP ${status}; no automatic retry. Check the response before resubmitting.`);
    }
  }
}
console.log(JSON.stringify(report, null, 2));
