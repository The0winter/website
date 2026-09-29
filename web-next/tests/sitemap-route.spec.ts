import {test,expect} from '@playwright/test';
import {GET} from '../app/sitemaps/[bookId]/[page]/route';

const book='1'.repeat(24),chapter='2'.repeat(24),request=new Request('https://sitemap.test/');
const fetchOriginal=globalThis.fetch,env={INTERNAL_API_URL:process.env.INTERNAL_API_URL,NEXT_PUBLIC_SITE_URL:process.env.NEXT_PUBLIC_SITE_URL};
test.beforeEach(()=>{process.env.INTERNAL_API_URL='http://127.0.0.1:5000/api';process.env.NEXT_PUBLIC_SITE_URL='https://sitemap.test';});
test.afterEach(()=>{globalThis.fetch=fetchOriginal;for(const [key,value] of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
test('one ID-only request keeps the public URLs and existing XML cache policy',async()=>{
  for(const page of [1,2]){
    let calls=0;
    globalThis.fetch=async(input,init)=>{calls++;expect(String(input)).toBe(`http://127.0.0.1:5000/api/books/${book}/sitemap-chapters?page=${page}`);expect(init?.cache).toBe('no-store');return Response.json([chapter]);};
    const response=await GET(request,{params:Promise.resolve({bookId:book,page:page+'.xml'})}),xml=await response.text();
    expect(response.status).toBe(200);expect(calls).toBe(1);expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(xml).toContain(`<loc>https://sitemap.test/book/${book}/${chapter}</loc>`);
    expect(xml.includes(`<loc>https://sitemap.test/book/${book}</loc>`)).toBe(page===1);
  }
});
test('empty books, missing pages, private work and backend outages retain their status semantics',async()=>{
  globalThis.fetch=async()=>Response.json([]);
  expect((await GET(request,{params:Promise.resolve({bookId:book,page:'1.xml'})})).status).toBe(200);
  expect((await GET(request,{params:Promise.resolve({bookId:book,page:'2.xml'})})).status).toBe(404);
  for(const status of [404,429,500,503]){
    globalThis.fetch=async()=>new Response('{}',{status});
    const response=await GET(request,{params:Promise.resolve({bookId:book,page:'1.xml'})});expect(response.status).toBe(status===404?404:503);
    if(status!==404){expect(response.headers.get('retry-after')).toBe('60');expect(response.headers.get('cache-control')).toBe('no-store');}
  }
});
test('invalid sitemap coordinates do not query the database API',async()=>{
  globalThis.fetch=async()=>{throw Error('Unexpected fetch');};
  for(const [bookId,page] of [[book,'0.xml'],[book,'20001.xml'],[book,'1.5.xml'],['bad','1.xml']])expect((await GET(request,{params:Promise.resolve({bookId,page})})).status).toBe(404);
});
