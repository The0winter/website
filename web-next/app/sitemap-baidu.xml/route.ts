import {siteUrl, sitemapUnavailable} from '@/lib/sitemap';
import {baiduXmlResponse} from '@/lib/baidu-sitemap';
import {getBaiduFiles} from '@/lib/baidu-sitemap-source';

export const dynamic = 'force-dynamic';

export async function GET() {
  try { return baiduXmlResponse((await getBaiduFiles())[0], siteUrl()); }
  catch { return sitemapUnavailable(); }
}
