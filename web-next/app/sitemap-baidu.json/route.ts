import {sitemapUnavailable} from '@/lib/sitemap';
import {getBaiduFileList} from '@/lib/baidu-sitemap-source';

export const dynamic = 'force-dynamic';

// Submit the listed XML files to Baidu, not this operational JSON manifest.
export async function GET() {
  try {
    return Response.json({files: await getBaiduFileList()}, {headers: {'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex'}});
  } catch { return sitemapUnavailable(); }
}
