import {siteUrl, sitemapUnavailable} from '@/lib/sitemap';
import {baiduFilePath} from '@/lib/baidu-sitemap';
import {getBaiduFiles} from '@/lib/baidu-sitemap-source';

export const dynamic = 'force-dynamic';

// Operational file list. Submit each XML file to Baidu, not this JSON manifest.
export async function GET() {
  try {
    const base = siteUrl(), files = await getBaiduFiles();
    return Response.json({urls: files.reduce((sum, file) => sum + file.urls, 0), files: files.map((file, index) => ({url: base + baiduFilePath(index + 1), urls: file.urls, bytes: file.bytes}))}, {headers: {'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex'}});
  } catch { return sitemapUnavailable(); }
}
