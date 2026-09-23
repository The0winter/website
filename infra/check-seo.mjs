// Read-only acceptance against a production build; never sends analytics events.
// node infra/check-seo.mjs http://127.0.0.1:3001 https://jiutianxiaoshuo.com --sitemaps
import assert from 'node:assert/strict';

const base = (process.argv[2] || 'https://jiutianxiaoshuo.com').replace(/\/+$/, '');
const site = (process.argv[3] || 'https://jiutianxiaoshuo.com').replace(/\/+$/, '');
const agent = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const report = {base, checkedAt: new Date().toISOString(), pages: [], sitemaps: [], urls: 0};

async function read(path, status = 200) {
  const response = await fetch(base + path, {headers: {'User-Agent': agent}, redirect: 'manual', signal: AbortSignal.timeout(30000)});
  assert.equal(response.status, status, `${path}: HTTP ${response.status}, expected ${status}`);
  return {response, body: await response.text()};
}
const locs = body => [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1].replaceAll('&amp;', '&'));
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');

async function page(path, {index = true, canonical = true, title: expectedTitle} = {}) {
  const {response, body} = await read(path);
  const robots = [...body.matchAll(/<meta\b[^>]*name="robots"[^>]*>/g)].map(match => match[0]).join(' ');
  assert.equal(/noindex/i.test(response.headers.get('x-robots-tag') || '') || /noindex/i.test(robots), !index, `${path}: indexing policy`);
  const titles = [...body.matchAll(/<title>([^<]+)<\/title>/g)];
  assert.equal(titles.length, 1, `${path}: one page title`);
  const title = titles[0][1];
  if (expectedTitle) assert.equal(title, escapeHtml(expectedTitle), `${path}: descriptive title`);
  const description = body.match(/<meta name="description" content="([^"]*)"/)?.[1];
  assert.ok(description?.trim(), `${path}: description`);
  if (index) {
    assert.equal(body.match(/<meta property="og:title" content="([^"]*)"/)?.[1], title, `${path}: matching share title`);
    assert.equal(body.match(/<meta property="og:description" content="([^"]*)"/)?.[1], description, `${path}: matching share description`);
  }
  if (canonical) {
    const href = body.match(/rel="canonical" href="([^"]+)"/)?.[1];
    assert.ok(href && new URL(href).href === new URL(site + path).href, `${path}: canonical`);
  }
  report.pages.push({path, status: response.status, index, title, description});
  return body;
}

const {body: robots} = await read('/robots.txt');
assert.match(robots, /^Allow: \/$/m);
assert.doesNotMatch(robots, /^Disallow: \/$/m);
assert.ok(robots.includes(`Sitemap: ${site}/sitemap.xml`));
const home = await page('/', {title: '九天小说站 - 热门小说免费在线阅读 - 笔趣阁'});
assert.equal([...home.matchAll(/<h1\b/gi)].length, 1, 'homepage has one shared primary heading across screen sizes');
assert.match(home, /<title>[^<]*笔趣阁[^<]*<\/title>/);
assert.ok(home.includes('G-DWMPP2NRQ1'), 'GA4 is included in the production HTML');
await page('/ranking');
const forum = await page('/forum');
assert.equal([...forum.matchAll(/<h1\b/gi)].length, 1, 'forum has one server-rendered primary heading');
assert.match(forum, /<h1\b[^>]*>书友社区<\/h1>/);
for (const path of ['/login', '/register', '/profile', '/writer', '/library', '/search', '/authorsList', '/forum/create']) await page(path, {index: false, canonical: false});

const {body: booksBody} = await read('/api/books?limit=100');
const books = JSON.parse(booksBody);
const book = books.find(item => item.title !== '测试');
assert.ok(book, 'public book exists');
const id = book.id || book._id;
const {body: chaptersBody} = await read(`/api/books/${id}/chapters?order=asc&limit=1`);
const [chapter] = JSON.parse(chaptersBody);
assert.ok(chapter, 'public chapter exists');
const chapterPath = `/book/${id}/${chapter.id}`;
const bookTitle = [book.title.trim(), book.author?.trim(), '在线免费阅读'].filter(Boolean).join('_') + ' - 九天小说站';
const detail = await page('/book/' + id, {title: bookTitle});
assert.ok(detail.includes(escapeHtml(`《${book.title.trim()}》${book.author?.trim() ? `，作者：${book.author.trim()}` : ''}。提供小说介绍、章节目录和在线免费阅读。`)), 'book description identifies the work and reading features');
const chapterTitle = chapter.title.trim().startsWith('第') ? chapter.title.trim() : `第${chapter.chapter_number}章 ${chapter.title.trim()}`;
const reader = await page(chapterPath, {title: `${chapterTitle} - ${book.title.trim()} - 九天小说站`});
assert.ok(reader.includes('reader-pages-root'), 'server renders chapter reader');
assert.ok(reader.includes('BreadcrumbList'), 'chapter breadcrumb schema');
const {body: contentBody} = await read('/api/chapters/' + chapter.id);
const content = JSON.parse(contentBody).content;
assert.ok(content?.length > 100, 'chapter body available');
const author = book.author_profile_id || (typeof book.author_id === 'string' ? book.author_id : book.author_id?._id);
if (author) {
  const {body: profileBody} = await read('/api/authors/' + author);
  const profile = JSON.parse(profileBody);
  await page('/author/' + author, {title: `${profile.username}的小说作品 - 九天小说站`});
}

const missing = '000000000000000000000001';
for (const path of [`/book/${missing}`, `/book/${id}/${missing}`, `/book/${missing}/${chapter.id}`, '/book/invalid', `/book/${id}/invalid`, `/author/${missing}`, '/author/invalid', `/forum/${missing}`, `/forum/question/${missing}`, '/seo-nonexistent-page']) {
  const {body} = await read(path, 404);
  assert.ok(body.includes('noindex'), `${path}: missing pages must not be indexed`);
  report.pages.push({path, status: 404});
}

const {body: index} = await read('/sitemap.xml');
assert.match(index, /<sitemapindex\b/);
const maps = locs(index);
assert.ok(maps.length > 2);
assert.equal(new Set(maps).size, maps.length, 'unique sitemap partitions');
const all = new Set();
for (const url of process.argv.includes('--sitemaps') ? maps : maps.slice(0, 3)) {
  assert.ok(url.startsWith(site + '/sitemaps/'), 'canonical sitemap origin');
  const {body} = await read(new URL(url).pathname);
  assert.match(body, /<urlset\b/);
  const entries = locs(body);
  assert.ok(entries.length <= 50000);
  for (const entry of entries) {
    assert.ok(entry.startsWith(site + '/'), 'canonical URL origin');
    assert.ok(!all.has(entry), 'duplicate URL: ' + entry);
    assert.ok(!/undefined|null|\/authorsList|\/writer|\/profile|\/library|\/search/.test(entry), 'non-public sitemap URL: ' + entry);
    all.add(entry);
  }
  report.sitemaps.push({url, entries: entries.length});
}
report.urls = all.size;
if (process.argv.includes('--baidu')) {
  assert.ok(process.argv.includes('--sitemaps'), '--baidu requires a complete sitemap comparison');
  const {body: manifestBody} = await read('/sitemap-baidu.json');
  const manifest = JSON.parse(manifestBody), seen = new Set(), files = [];
  assert.ok(manifest.files.length > 0);
  for (const [index, file] of manifest.files.entries()) {
    const path = index === 0 ? '/sitemap-baidu.xml' : `/sitemaps/baidu/${index + 1}.xml`;
    assert.equal(file.url, site + path);
    const {body} = await read(path);
    assert.match(body, /<urlset\b/);
    assert.doesNotMatch(body, /<sitemapindex\b/);
    const urls = locs(body), bytes = Buffer.byteLength(body, 'utf8');
    assert.ok(urls.length > 0 && urls.length <= 50000 && bytes < 10_000_000);
    for (const url of urls) {
      assert.ok(all.has(url), 'Baidu contains only canonical public URLs: ' + url);
      assert.ok(!seen.has(url), 'Duplicate across Baidu files: ' + url);
      seen.add(url);
    }
    files.push({url: file.url, urls: urls.length, bytes});
  }
  assert.equal(seen.size, all.size, 'Baidu files cover every public sitemap URL');
  await read(`/sitemaps/baidu/${manifest.files.length + 1}.xml`, 404);
  await read('/sitemaps/baidu/invalid.xml', 404);
  report.baidu = {urls: seen.size, files};
}
report.sampleChapter = chapterPath;
console.log(JSON.stringify(report, null, 2));
