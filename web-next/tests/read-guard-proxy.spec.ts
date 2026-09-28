import {test, expect} from '@playwright/test';
import {NextRequest} from 'next/server';
import {proxy} from '../proxy';
import robots from '../app/robots';

const book='111111111111111111111111', chapter='222222222222222222222222';
const realFetch=globalThis.fetch, saved={api:process.env.INTERNAL_API_URL, secret:process.env.INTERNAL_API_SECRET, mode:process.env.READ_GUARD_MODE};
test.beforeEach(()=>{process.env.INTERNAL_API_URL='http://127.0.0.1:5000/api';process.env.INTERNAL_API_SECRET='x'.repeat(48);process.env.READ_GUARD_MODE='enforce';});
test.afterEach(()=>{globalThis.fetch=realFetch;for(const [key,value] of Object.entries({INTERNAL_API_URL:saved.api,INTERNAL_API_SECRET:saved.secret,READ_GUARD_MODE:saved.mode})){if(value===undefined)delete process.env[key];else process.env[key]=value;}});

test('denials happen before document lookup, including RSC and prefetch attempts',async()=>{
  for(const headers of [{},{rsc:'1'},{'next-router-prefetch':'1'},{'x-internal-api-secret':'forged'}] as Record<string,string>[]) {
    let calls=0;
    globalThis.fetch=async(input,init)=>{calls++;expect(String(input)).toBe('http://127.0.0.1:5000/internal/reader-guard');expect(new Headers(init?.headers).get('x-internal-api-secret')).toBe('x'.repeat(48));return Response.json({status:429,retryAfter:120});};
    const response=await proxy(new NextRequest(`https://jiutianxiaoshuo.com/book/${book}/${chapter}`,{headers}));
    expect(response.status).toBe(429);expect(response.headers.get('retry-after')).toBe('120');expect(calls).toBe(1);
    expect(await response.text()).toContain('当前阅读进度会保留');
  }
});

test('allowed requests set a visitor cookie, use the small lookup, and RSC avoids redundant lookup',async()=>{
  const calls:string[]=[];
  globalThis.fetch=async(input,init)=>{
    calls.push(String(input));
    if(String(input).endsWith('/internal/reader-guard')) {
      expect(JSON.parse(String(init?.body)).ip).toBe('203.0.113.9');
      return Response.json({status:200},{headers:{'Set-Cookie':'__Host-reader-access=signed; Path=/; Secure; HttpOnly; SameSite=Lax'}});
    }
    expect(String(input)).toContain(`/chapter-exists/${chapter}`);return Response.json({exists:true});
  };
  const url=`https://jiutianxiaoshuo.com/book/${book}/${chapter}`;
  const response=await proxy(new NextRequest(url,{headers:{'x-forwarded-for':'203.0.113.9'}}));
  expect(response.headers.get('set-cookie')).toContain('__Host-reader-access');expect(calls.length).toBe(2);
  calls.length=0;expect((await proxy(new NextRequest(url,{headers:{'x-forwarded-for':'203.0.113.9',rsc:'1'}}))).headers.get('x-middleware-next')).toBe('1');expect(calls.length).toBe(1);
});

test('a guard outage is retryable and robots keeps search indexing separate from training crawlers',async()=>{
  globalThis.fetch=async()=>{throw Error('offline');};
  expect((await proxy(new NextRequest(`https://jiutianxiaoshuo.com/book/${book}/${chapter}`))).status).toBe(503);
  const original=process.env.SITE_INDEXING;process.env.SITE_INDEXING='enabled';
  try {const rules=robots().rules;expect(Array.isArray(rules)).toBe(true);expect(JSON.stringify(rules)).toContain('ClaudeBot');expect(JSON.stringify(rules)).toContain('"allow":"/"');}
  finally {if(original===undefined)delete process.env.SITE_INDEXING;else process.env.SITE_INDEXING=original;}
});
