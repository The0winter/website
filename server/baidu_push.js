import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const SITE = 'https://jiutianxiaoshuo.com';
const publicPath = /^(?:\/|\/(?:ranking|forum)|\/book\/[a-f0-9]{24}(?:\/[a-f0-9]{24})?|\/author\/[a-f0-9]{24})$/;

function publicUrl(value) {
  const url = new URL(value);
  assert.equal(url.origin, SITE, 'Only the canonical website may be submitted');
  assert.ok(!url.search && !url.hash && !url.username && !url.password, 'Unexpected URL components');
  assert.match(url.pathname, publicPath, 'Only public content pages may be submitted');
  return url.href;
}

export async function collectPublicUrls(fetcher = fetch) {
  const queue = [SITE + '/sitemap.xml'];
  const visited = new Set();
  const urls = new Set();
  while (queue.length) {
    const map = queue.shift();
    if (visited.has(map)) continue;
    const parsed = new URL(map);
    assert.equal(parsed.origin, SITE, 'Unexpected sitemap host');
    assert.ok(!parsed.search && !parsed.hash && !parsed.username && !parsed.password);
    assert.ok(parsed.pathname === '/sitemap.xml' || parsed.pathname.startsWith('/sitemaps/'));
    visited.add(map);
    assert.ok(visited.size <= 1000, 'Sitemap count limit');
    const response = await fetcher(map, {redirect: 'error', signal: AbortSignal.timeout(30000)});
    assert.equal(response.status, 200, 'Sitemap is temporarily unavailable; no partial submission');
    const xml = await response.text();
    assert.ok(!/<!DOCTYPE|<!ENTITY/i.test(xml), 'Unsupported sitemap declaration');
    const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replaceAll('&amp;', '&'));
    if (/<sitemapindex\b/.test(xml)) queue.push(...locations);
    else {
      assert.match(xml, /<urlset\b/, 'Expected sitemap URL set');
      for (const value of locations) urls.add(publicUrl(value));
    }
    assert.ok(urls.size <= 200000, 'URL count limit');
  }
  assert.ok(urls.size > 0, 'No public URLs found');
  const priority = value => {
    const route = new URL(value).pathname;
    if (route === '/') return 0;
    if (route === '/ranking' || route === '/forum') return 1;
    if (/^\/book\/[a-f0-9]{24}$/.test(route)) return 2;
    if (route.startsWith('/author/')) return 3;
    return 4;
  };
  return [...urls].sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
}

export async function submitBatch(urls, token, fetcher = fetch) {
  assert.ok(token && /^[a-zA-Z0-9_-]+$/.test(token), 'BAIDU_PUSH_TOKEN is required');
  assert.ok(urls.length > 0 && urls.length <= 1000, 'Submit between 1 and 1000 URLs per invocation');
  const list = [...new Set(urls.map(publicUrl))];
  // This is the API endpoint documented and issued by Baidu's platform.
  const endpoint = new URL('http://data.zz.baidu.com/urls');
  endpoint.search = new URLSearchParams({site: SITE, token}).toString();
  const response = await fetcher(endpoint, {
    method: 'POST', headers: {'Content-Type': 'text/plain; charset=utf-8'},
    body: list.join('\n'), redirect: 'error', signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Baidu HTTP ${response.status}; submission was not confirmed`);
  const data = await response.json();
  if (data.error) throw new Error(`Baidu error ${Number(data.error)}; submission was not confirmed`);
  assert.ok(Number.isInteger(data.success) && data.success >= 0 && data.success <= list.length, 'Invalid Baidu success count');
  const rejected = new Set([...(data.not_same_site || []), ...(data.not_valid || [])]);
  const accepted = list.filter(url => !rejected.has(url));
  assert.equal(data.success, accepted.length, 'Ambiguous partial success; history was not advanced');
  return {accepted, rejected: list.filter(url => rejected.has(url)), remain: data.remain};
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  let limit = 10;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') continue;
    assert.equal(args[i], '--limit', 'Supported arguments: --apply --limit N');
    limit = Number(args[++i]);
  }
  assert.ok(Number.isInteger(limit) && limit > 0 && limit <= 1000, 'Limit must be 1–1000 and within the platform quota');
  const token = process.env.BAIDU_PUSH_TOKEN;
  if (apply) assert.ok(token, 'Set BAIDU_PUSH_TOKEN from the verified canonical site before applying');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const historyFile = process.env.BAIDU_HISTORY_FILE || path.join(root, '.runtime/baidu-seo/pushed_history.json');
  let history = {version: 2, site: SITE, accepted: []};
  try { history = JSON.parse(await readFile(historyFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.equal(history.version, 2, 'Use a new history file for canonical URLs');
  assert.equal(history.site, SITE);
  assert.ok(Array.isArray(history.accepted));
  const old = new Set(history.accepted.map(publicUrl));
  const all = await collectPublicUrls();
  const pending = all.filter(url => !old.has(url));
  const batch = pending.slice(0, limit);
  const report = {mode: apply ? 'apply' : 'preview', site: SITE, discovered: all.length, pending: pending.length, selected: batch, submitted: 0};
  if (apply && batch.length) {
    const result = await submitBatch(batch, token);
    report.submitted = result.accepted.length;
    report.remain = result.remain;
    report.rejected = result.rejected;
    history.accepted = [...new Set([...old, ...result.accepted])];
    await mkdir(path.dirname(historyFile), {recursive: true});
    const temp = historyFile + '.' + process.pid + '.tmp';
    await writeFile(temp, JSON.stringify(history, null, 2), {mode: 0o600});
    await rename(temp, historyFile);
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(String(error.message).replace(/token=[^&\s]+/gi, 'token=[REDACTED]'));
    process.exitCode = 1;
  });
}
