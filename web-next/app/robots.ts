import type {MetadataRoute} from 'next';
import {siteOrigin} from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  if (process.env.SITE_INDEXING !== 'enabled') return {rules: {userAgent: '*', disallow: '/'}};
  // Crawlers must be able to read the noindex metadata on account/search pages.
  // Authentication protects private content; robots.txt does not.
  return {rules: {userAgent: '*', allow: '/', disallow: ['/api/', '/health/']}, sitemap: siteOrigin + '/sitemap.xml'};
}
