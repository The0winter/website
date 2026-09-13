import {GET as getIndex} from '@/app/sitemap.xml/route';
import {GET as getStatic} from '@/app/sitemaps/static.xml/route';
import {GET as getAuthors} from '@/app/sitemaps/authors.xml/route';
import {GET as getChapters} from '@/app/sitemaps/[bookId]/[page]/route';
import {siteUrl, sitemapUnavailable, xmlResponse} from '@/lib/sitemap';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const base = siteUrl();
    const index = await getIndex();
    if (!index.ok) return sitemapUnavailable();
    const partitions = [...(await index.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    const entries = new Map<string, string>();
    for (const partition of partitions) {
      const url = new URL(partition);
      if (url.origin !== base || url.search || url.hash) throw new Error('Unexpected partition');
      let response: Response;
      if (url.pathname === '/sitemaps/static.xml') response = getStatic();
      else if (url.pathname === '/sitemaps/authors.xml') response = await getAuthors();
      else {
        const match = url.pathname.match(/^\/sitemaps\/([a-f0-9]{24})\/([1-9][0-9]*\.xml)$/);
        if (!match) throw new Error('Unexpected partition');
        response = await getChapters(new Request(partition), {params: Promise.resolve({bookId: match[1], page: match[2]})});
      }
      if (!response.ok) return sitemapUnavailable();
      const xml = await response.text();
      if (!xml.includes('<urlset')) throw new Error('Expected URL set');
      for (const match of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>[\s\S]*?<\/url>/g)) entries.set(match[1], match[0]);
      if (entries.size > 50000) throw new Error('Baidu file URL limit; split the feed before expanding');
    }
    if (!entries.size) throw new Error('Empty sitemap');
    const body = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + [...entries.values()].join('') + '</urlset>';
    if (Buffer.byteLength(body, 'utf8') >= 10_000_000 - 100) throw new Error('Baidu file size limit');
    return xmlResponse(body);
  } catch {
    return sitemapUnavailable();
  }
}
