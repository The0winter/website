import {siteUrl, sitemapUnavailable} from '@/lib/sitemap';
import {baiduXmlResponse} from '@/lib/baidu-sitemap';
import {getBaiduFile} from '@/lib/baidu-sitemap-source';

export const dynamic = 'force-dynamic';

export async function GET() {
  try { return baiduXmlResponse((await getBaiduFile(1))!, siteUrl()); }
  catch { return sitemapUnavailable(); }
}

