import {xmlResponse} from '@/lib/sitemap';

const open = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
const close = '</urlset>';
const envelopeBytes = Buffer.byteLength('<?xml version="1.0" encoding="UTF-8"?>' + open + close);
export const baiduLimits = {urls: 50000, bytes: 9_500_000};
export type BaiduFile = {body: string; urls: number; bytes: number};

// Include the XML declaration and count UTF-8 bytes, not JS characters.
export function splitBaiduEntries(entries: Iterable<string>, limits = baiduLimits): BaiduFile[] {
  const files: BaiduFile[] = [];
  let rows: string[] = [], bytes = envelopeBytes;
  const flush = () => {
    if (rows.length) files.push({body: open + rows.join('') + close, urls: rows.length, bytes});
    rows = []; bytes = envelopeBytes;
  };
  for (const entry of entries) {
    const size = Buffer.byteLength(entry, 'utf8');
    if (envelopeBytes + size > limits.bytes) throw new Error('Single sitemap entry exceeds byte limit');
    if (rows.length >= limits.urls || bytes + size > limits.bytes) flush();
    rows.push(entry); bytes += size;
  }
  flush();
  if (!files.length) throw new Error('Empty sitemap');
  return files;
}

// Publish only complete generations. Failed refreshes stay retryable; overlapping
// reads share one job rather than multiplying upstream traffic.
export function cacheBaiduFiles(load: () => Promise<BaiduFile[]>, ttl = 300000, now = Date.now) {
  let cached: BaiduFile[] | undefined, expires = 0, pending: Promise<BaiduFile[]> | undefined;
  return () => {
    if (cached && now() < expires) return Promise.resolve(cached);
    if (!pending) pending = load().then(files => {
      cached = files; expires = now() + ttl; return files;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}

export const baiduFilePath = (page: number) => page === 1 ? '/sitemap-baidu.xml' : `/sitemaps/baidu/${page}.xml`;
export function baiduXmlResponse(file: BaiduFile, base: string) {
  const response = xmlResponse(file.body);
  response.headers.set('Link', `<${base}/sitemap-baidu.json>; rel="describedby"`);
  return response;
}
