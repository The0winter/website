import {siteUrl, sitemapUnavailable} from '@/lib/sitemap';
import {baiduXmlResponse} from '@/lib/baidu-sitemap';
import {getBaiduFile} from '@/lib/baidu-sitemap-source';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, {params}: {params: Promise<{page: string}>}) {
  const match = (await params).page.match(/^([1-9][0-9]*)\.xml$/);
  const page = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(page) || page < 2) return new Response(null, {status: 404});
  try {
    const file = await getBaiduFile(page);
    return file ? baiduXmlResponse(file, siteUrl()) : new Response(null, {status: 404});
  } catch { return sitemapUnavailable(); }
}
