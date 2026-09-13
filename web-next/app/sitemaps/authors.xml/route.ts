import {getApiBaseUrl} from '@/utils/api';
import {safeFetch} from '@/lib/request';
import {siteUrl, xmlEscape, xmlResponse, sitemapUnavailable} from '@/lib/sitemap';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const authors = new Set<string>();
    for (let page = 1; ; page++) {
      const response = await safeFetch(`${getApiBaseUrl()}/books?limit=100&page=${page}&orderBy=createdAt&order=asc`, {next: {revalidate: 300}});
      if (!response.ok) throw new Error('Authors unavailable');
      const books: Array<{author_profile_id?: string; author_id?: string | {_id: string}}> = await response.json();
      for (const book of books) {
        const id = book.author_profile_id || (typeof book.author_id === 'string' ? book.author_id : book.author_id?._id);
        if (id && /^[a-f0-9]{24}$/i.test(id)) authors.add(id);
      }
      if (authors.size > 50000 || page > 500) return sitemapUnavailable();
      if (books.length < 100) break;
    }
    return xmlResponse('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + [...authors].map(id => `<url><loc>${xmlEscape(siteUrl() + '/author/' + id)}</loc></url>`).join('') + '</urlset>');
  } catch { return sitemapUnavailable(); }
}
