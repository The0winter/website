import type {MetadataRoute} from 'next';
export default function robots():MetadataRoute.Robots {
 const production=process.env.SITE_INDEXING==='enabled';
 return {rules:{userAgent:'*',...(production?{allow:'/',disallow:['/writer','/profile','/library']}:{disallow:'/'})},...(production?{sitemap:process.env.NEXT_PUBLIC_SITE_URL+'/sitemap.xml'}:{})};
}
