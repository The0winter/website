import {GET as getIndex} from '@/app/sitemap.xml/route';
import {GET as getStatic} from '@/app/sitemaps/static.xml/route';
import {GET as getAuthors} from '@/app/sitemaps/authors.xml/route';
import {GET as getChapters} from '@/app/sitemaps/[bookId]/[page]/route';
import {getApiBaseUrl} from '@/utils/api';
import {siteUrl} from '@/lib/sitemap';
import {cacheBaiduFiles, splitBaiduEntries} from '@/lib/baidu-sitemap';

async function loadFiles() {
  const base = siteUrl();
  const index = await getIndex();
  if (!index.ok) throw new Error('Sitemap index unavailable');
  const partitions = [...(await index.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  if (!partitions.length) throw new Error('Empty sitemap index');
  const bodies: string[] = new Array(partitions.length);
  let next = 0, failed = false;
  // Bound upstream load while avoiding the former serial cold-generation timeout.
  await Promise.all(Array.from({length: Math.min(6, partitions.length)}, async () => {
    while (!failed && next < partitions.length) {
      const position = next++;
      try {
        const partition = partitions[position], url = new URL(partition);
        if (url.origin !== base || url.search || url.hash) throw new Error('Unexpected partition');
        let response: Response;
        if (url.pathname === '/sitemaps/static.xml') response = getStatic();
        else if (url.pathname === '/sitemaps/authors.xml') response = await getAuthors();
        else {
          const match = url.pathname.match(/^\/sitemaps\/([a-f0-9]{24})\/([1-9][0-9]*\.xml)$/);
          if (!match) throw new Error('Unexpected partition');
          response = await getChapters(new Request(partition), {params: Promise.resolve({bookId: match[1], page: match[2]})});
        }
        if (!response.ok) throw new Error('Sitemap partition unavailable');
        bodies[position] = await response.text();
        if (!bodies[position].includes('<urlset')) throw new Error('Expected URL set');
      } catch (error) { failed = true; throw error; }
    }
  }));
  const entries = new Map<string, string>();
  for (const body of bodies) {
    for (const match of body.matchAll(/<url>\s*<loc>([^<]+)<\/loc>[\s\S]*?<\/url>/g)) {
      const url = new URL(match[1]);
      if (url.origin !== base || url.search || url.hash || !/^\/(?:$|ranking$|forum$|author\/[a-f0-9]{24}$|book\/[a-f0-9]{24}(?:\/[a-f0-9]{24})?$)/i.test(url.pathname)) throw new Error('Non-public sitemap URL');
      entries.set(match[1], match[0]);
    }
  }
  return splitBaiduEntries(entries.values());
}

// Route bundles share one process-local generation; only public XML is cached.
const state = globalThis as typeof globalThis & {baiduSitemapFiles?: {key: string; read: ReturnType<typeof cacheBaiduFiles>}};
export function getBaiduFiles() {
  const key = siteUrl() + '|' + getApiBaseUrl();
  if (state.baiduSitemapFiles?.key !== key) state.baiduSitemapFiles = {key, read: cacheBaiduFiles(loadFiles)};
  return state.baiduSitemapFiles.read();
}
