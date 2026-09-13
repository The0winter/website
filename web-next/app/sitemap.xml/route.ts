import {getApiBaseUrl} from '@/utils/api';
import {safeFetch} from '@/lib/request';
import {siteUrl,xmlEscape,xmlResponse,lastModified,sitemapUnavailable} from '@/lib/sitemap';
export const dynamic = 'force-dynamic';
export async function GET(){
  try{
    const base=siteUrl(),urls=[{url:base+'/sitemaps/static.xml',lastmod:''},{url:base+'/sitemaps/authors.xml',lastmod:''}];
    for(let page=1;;page++){
      const response=await safeFetch(`${getApiBaseUrl()}/sitemap-books?page=${page}`, {next:{revalidate:300}});
      if(!response.ok)throw new Error('Sitemap source unavailable');
      const books:Array<{_id:string;chapters:number;updatedAt?:string}>=await response.json();
      for(const book of books)for(let i=1;i<=Math.max(1,Math.ceil(book.chapters/1000));i++)urls.push({url:`${base}/sitemaps/${book._id}/${i}.xml`,lastmod:lastModified(book.updatedAt)});
      if(urls.length>50000)return sitemapUnavailable();
      if(books.length<100)break;
    }
    return xmlResponse('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(({url,lastmod})=>`<sitemap><loc>${xmlEscape(url)}</loc>${lastmod}</sitemap>`).join('')+'</sitemapindex>');
  }catch{return sitemapUnavailable();}
}
