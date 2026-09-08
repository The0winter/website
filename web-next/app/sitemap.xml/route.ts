import {getApiBaseUrl} from '@/utils/api';
import {safeFetch} from '@/lib/request';
import {siteUrl,xmlEscape,xmlResponse} from '@/lib/sitemap';
export const dynamic = 'force-dynamic';
export async function GET(){
  try{
    const base=siteUrl(),urls=[base+'/sitemaps/static.xml'];
    for(let page=1;;page++){
      const response=await safeFetch(`${getApiBaseUrl()}/sitemap-books?page=${page}`);
      if(!response.ok)throw new Error('Sitemap source unavailable');
      const books:Array<{_id:string;chapters:number}>=await response.json();
      for(const book of books)for(let i=1;i<=Math.max(1,Math.ceil(book.chapters/1000));i++)urls.push(`${base}/sitemaps/${book._id}/${i}.xml`);
      if(books.length<100)break;
    }
    if(urls.length>50000)return new Response('Sitemap index capacity requires partitioning',{status:503});
    return xmlResponse('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(url=>`<sitemap><loc>${xmlEscape(url)}</loc></sitemap>`).join('')+'</sitemapindex>');
  }catch{return new Response('Sitemap source temporarily unavailable',{status:503,headers:{'Cache-Control':'no-store'}});}
}
