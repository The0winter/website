import {getApiBaseUrl} from '@/utils/api';
import {safeFetch} from '@/lib/request';
import {siteUrl,xmlEscape,xmlResponse} from '@/lib/sitemap';
export async function GET(_request:Request,{params}:{params:Promise<{bookId:string;page:string}>}){
  const {bookId,page:raw}=await params;const match=raw.match(/^([1-9][0-9]*)\.xml$/);if(!/^[a-f0-9]{24}$/.test(bookId)||!match)return new Response(null,{status:404});
  const page=Number(match[1]);if(!Number.isSafeInteger(page)||page>20000)return new Response(null,{status:404});
  try{
    const urls:string[]=page===1?[`${siteUrl()}/book/${bookId}`]:[];
    for(let part=1;part<=5;part++){
      const response=await safeFetch(`${getApiBaseUrl()}/books/${bookId}/chapters?limit=200&page=${(page-1)*5+part}`);
      if(response.status===404)return new Response(null,{status:404});if(!response.ok)throw new Error('Unavailable');
      const chapters:Array<{id:string}>=await response.json();for(const chapter of chapters)urls.push(`${siteUrl()}/book/${bookId}/${chapter.id}`);if(chapters.length<200)break;
    }
    if(!urls.length)return new Response(null,{status:404});
    return xmlResponse('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(url=>`<url><loc>${xmlEscape(url)}</loc></url>`).join('')+'</urlset>');
  }catch{return new Response('Sitemap source temporarily unavailable',{status:503,headers:{'Cache-Control':'no-store'}});}
}
