import {siteUrl,xmlEscape,xmlResponse} from '@/lib/sitemap';
export function GET(){return xmlResponse('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+['','/ranking','/authorsList','/forum'].map(path=>`<url><loc>${xmlEscape(siteUrl()+path)}</loc></url>`).join('')+'</urlset>');}
