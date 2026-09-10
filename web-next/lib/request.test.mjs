import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {catalogPages} from './request.ts';

const rows = (page, total) => Array.from({length:Math.min(200, Math.max(0, total-(page-1)*200))}, (_, index) => (page-1)*200+index+1);
const response = (page, total, withTotal=true) => new Response(JSON.stringify(rows(page,total)), {headers:withTotal?{'X-Total-Count':String(total)}:{}});

test('catalog loading', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  await t.test('publishes the first page before later pages finish, preserves order, and bounds concurrency', async () => {
    const calls=[], progress=[];
    let active=0, maximum=0, release;
    const gate=new Promise(resolve => {release=resolve;});
    globalThis.fetch=async input => {
      const page=Number(new URL(String(input),'http://local').searchParams.get('page'));
      calls.push(page);active++;maximum=Math.max(maximum,active);
      if(page>1){await gate;await delay(page===2?30:1);}
      active--;return response(page,1238);
    };
    const pending=catalogPages('/parallel',{onProgress:data=>progress.push([...data])});
    await delay(10);
    assert.deepEqual(progress,[rows(1,1238)]);
    assert.deepEqual(calls,[1,2,3,4]);
    release();
    assert.deepEqual(await pending,Array.from({length:1238},(_,i)=>i+1));
    assert.equal(maximum,3);
    assert.equal(calls.length,7);
    for(const data of progress)assert.deepEqual(data,Array.from({length:data.length},(_,i)=>i+1));
  });

  await t.test('reuses the server page and does not fetch an empty page at an exact boundary',async()=>{
    const calls=[];
    globalThis.fetch=async input=>{const page=Number(new URL(String(input),'http://local').searchParams.get('page'));calls.push(page);return response(page,400);};
    assert.equal((await catalogPages('/seed',{initialPage:{rows:rows(1,400),total:400}})).length,400);
    assert.deepEqual(calls,[2]);
    calls.length=0;
    assert.equal((await catalogPages('/small',{initialPage:{rows:rows(1,12),total:12}})).length,12);
    assert.deepEqual(calls,[]);
  });

  await t.test('descending pagination appends older chapters without replacing the visible prefix',async()=>{
    const progress=[];
    globalThis.fetch=async input=>{
      const url=new URL(String(input),'http://local');assert.equal(url.searchParams.get('order'),'desc');
      const page=Number(url.searchParams.get('page'));
      await delay(page===2?15:1);
      return new Response(JSON.stringify(rows(page,1238).map(number=>1239-number)),{headers:{'X-Total-Count':'1238'}});
    };
    const result=await catalogPages('/descending?order=desc',{onProgress:data=>progress.push([...data])});
    assert.deepEqual(result,Array.from({length:1238},(_,i)=>1238-i));
    for(const data of progress)assert.deepEqual(data.slice(0,30),Array.from({length:30},(_,i)=>1238-i));
  });

  await t.test('cancelling a sort stops publishing or requesting further pages',async()=>{
    const controller=new AbortController(),calls=[],progress=[];
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    globalThis.fetch=async input=>{
      const page=Number(new URL(String(input),'http://local').searchParams.get('page'));calls.push(page);
      if(page>1)await gate;
      return response(page,1238);
    };
    const pending=catalogPages('/cancel',{signal:controller.signal,onProgress:data=>progress.push(data.length)});
    await delay(10);controller.abort();release();
    await assert.rejects(pending,{name:'AbortError'});
    assert.deepEqual(calls,[1,2,3,4]);assert.deepEqual(progress,[200]);
  });

  await t.test('overlapping callers share reads, but the next load sees new chapters',async()=>{
    let count=0,total=12;
    globalThis.fetch=async()=>{count++;await delay(10);return response(1,total);};
    const both=await Promise.all([catalogPages('/overlap'),catalogPages('/overlap')]);
    assert.equal(count,1);assert.deepEqual(both[0],both[1]);
    total=13;assert.equal((await catalogPages('/overlap')).length,13);assert.equal(count,2);
  });

  await t.test('failed pages surface an error and can be retried without caching failure',async()=>{
    let fail=true;
    globalThis.fetch=async input=>{const page=Number(new URL(String(input),'http://local').searchParams.get('page'));return page===2&&fail?new Response('',{status:503}):response(page,201);};
    await assert.rejects(catalogPages('/retry'),/目录暂不可用/);
    fail=false;assert.equal((await catalogPages('/retry')).length,201);
  });

  await t.test('endpoints without a total header and empty books remain supported',async()=>{
    globalThis.fetch=async input=>response(Number(new URL(String(input),'http://local').searchParams.get('page')),201,false);
    assert.equal((await catalogPages('/legacy')).length,201);
    globalThis.fetch=async()=>response(1,0);
    assert.deepEqual(await catalogPages('/empty'),[]);
  });
});
