import {getApiBaseUrl} from '@/utils/api';
import {safeFetch} from '@/lib/request';
import {siteUrl,xmlEscape,xmlResponse,sitemapUnavailable} from '@/lib/sitemap';
export const dynamic = 'force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{bookId:string;page:string}>}){
  const {bookId,page:raw}=await params;const match=raw.match(/^([1-9][0-9]*)\.xml$/);if(!/^[a-f0-9]{24}$/.test(bookId)||!match)return new Response(null,{status:404});
  const page=Number(match[1]);if(!Number.isSafeInteger(page)||page>20000)return new Response(null,{status:404});
  try{
    const urls:string[]=page===1?[`${siteUrl()}/book/${bookId}`]:[];
    const response=await safeFetch(`${getApiBaseUrl()}/books/${bookId}/sitemap-chapters?page=${page}`, {cache:'no-store'});
    if(response.status===404)return new Response(null,{status:404});if(!response.ok)throw new Error('Unavailable');
    const ids:string[]=await response.json();for(const id of ids)urls.push(`${siteUrl()}/book/${bookId}/${id}`);
    if(!urls.length)return new Response(null,{status:404});
    return xmlResponse('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(url=>`<url><loc>${xmlEscape(url)}</loc></url>`).join('')+'</urlset>');
  }catch{return sitemapUnavailable();}
}
