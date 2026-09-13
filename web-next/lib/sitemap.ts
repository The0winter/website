export const siteUrl=()=>{const value=process.env.NEXT_PUBLIC_SITE_URL;if(!value)throw new Error('NEXT_PUBLIC_SITE_URL is required');return value.replace(/\/+$/,'');};
export const xmlEscape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export const xmlResponse=(body:string)=>new Response('<?xml version="1.0" encoding="UTF-8"?>'+body,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=300'}});
export function lastModified(value: string | undefined): string {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? `<lastmod>${date.toISOString()}</lastmod>` : '';
}
export const sitemapUnavailable = () => new Response('Sitemap source temporarily unavailable', {status: 503, headers: {'Cache-Control': 'no-store', 'Retry-After': '60'}});
