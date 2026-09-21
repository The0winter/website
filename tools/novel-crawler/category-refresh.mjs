import fs from 'node:fs';
import path from 'node:path';
import {load} from 'cheerio';
import {loadSites} from './desktop/sources.mjs';
import {makeClient, decode} from './http.mjs';
import {selectValue, extractBookCategory} from './adapters.mjs';
import {checkIdentity} from './quality.mjs';
import {atomicWrite, readJson} from './storage.mjs';
import {hasBookCategory} from './categories.mjs';
import {lookupPublisherCategory} from './publisher-category.mjs';

// Read-only collection. Writes evidence and a review plan, never books or the DB.
export async function collectBookCategories({books, plans, stateDir, artifactDir, onProgress = () => {}}) {
  const file = path.join(artifactDir, 'collected.json'), report = readJson(file, {books: {}, startedAt: new Date().toISOString()}), sites = loadSites().sites;
  const pending = [];
  for (const book of books) {
    if (hasBookCategory(book.category) || report.books[book.id]?.category) continue;
    const matches = plans.filter(p => p.title === book.title && p.author === book.author && p.sourceUrl === book.sourceUrl);
    if (matches.length !== 1 || !matches[0].spec) {
      report.books[book.id] = {id: book.id, title: book.title, author: book.author, sourceUrl: book.sourceUrl, error: '当前本地来源绑定不唯一或不可用'};
      continue;
    }
    pending.push({book, plan: matches[0]});
  }
  // Probe the publisher once before parallel source lanes; an access failure is
  // shared via the bounded cooldown instead of repeated for every book.
  if (pending.length) await lookupPublisherCategory(pending[0].book, stateDir);
  const groups = [...Map.groupBy(pending, ({plan}) => new URL(plan.url).hostname).values()];
  async function lane() {
    while (groups.length) {
      const group = groups.shift(), site = sites.find(s => s.hosts.includes(new URL(group[0].plan.url).hostname));
      if (!site) throw Error('未适配的绑定来源');
      const client = makeClient({cacheDir: path.join(artifactDir, 'cache', site.id), allowedHosts: [...site.hosts, ...(site.spec.allowedHosts || [])], delayMs: site.spec.delayMs, retries: 0, timeoutMs: 15000,
        browser: {...site.spec.browser, headless: true, manualVerificationMs: undefined, manualLogin: undefined, manualCaptcha: undefined}});
      try {
        for (const {book, plan} of group) {
          const item = {id: book.id, title: book.title, author: book.author, sourceUrl: book.sourceUrl, boundSourceUrl: plan.url, previousCategory: book.category};
          try {
            const publisher = await lookupPublisherCategory(book, stateDir);
            item.publisherAttempt = publisher.publisherAttempt;
            if (publisher.category) Object.assign(item, publisher);
            else {
              const page = await client.get(plan.url, {fresh: true, encoding: site.spec.encoding, render: (site.book.transport || site.spec.transport) === 'browser', readySelector: site.book.readySelector});
              const $ = load(decode(page.body, page.contentType, site.spec.encoding));
              const actual = {title: selectValue($, site.book.metadata.title), author: selectValue($, site.book.metadata.author)};
              checkIdentity(plan.spec, actual);
              Object.assign(item, extractBookCategory($, site.book.metadata.category, page), {sourceIdentity: actual});
            }
          } catch (error) { item.error = error.message; }
          report.books[book.id] = item;
          atomicWrite(file, report);
          onProgress({checked: Object.keys(report.books).length, collected: Object.values(report.books).filter(b => b.category).length, title: book.title, category: item.category, error: item.error});
        }
      } finally { await client.close(); }
    }
  }
  await Promise.all(Array.from({length: Math.min(3, groups.length)}, lane));
  report.finishedAt = new Date().toISOString();
  atomicWrite(file, report);
  return report;
}
