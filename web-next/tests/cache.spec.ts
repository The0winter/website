import {test,expect} from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
const base='http://127.0.0.1:3000';
test('real reader caches evict across 30 chapters and five books',async({page,context})=>{
  test.setTimeout(180000);
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  async function write(url:string,data:object,headers:Record<string,string>={}){const csrf=await (await page.request.get(base+'/api/auth/csrf')).json();return page.request.post(base+url,{data,headers:{origin:base,'x-csrf-token':csrf.csrfToken,...headers}});}
  expect((await write('/api/auth/signin',{email:'reader@example.test',password:'Local-test-12345'})).status()).toBe(200);
  const books:{id:string;chapterIds:string[]}[]=[],samples:object[]=[];
  const cdp=await context.newCDPSession(page);
  try{
    for(let b=0;b<5;b++){
      const response=await write('/api/books',{title:`缓存边界 ${Date.now()}-${b}`,description:'受控缓存对象验证'},{'Idempotency-Key':crypto.randomUUID()});expect(response.ok()).toBe(true);
      const book={id:(await response.json()).id,chapterIds:[] as string[]};books.push(book);
      for(let number=1;number<=(b===0?30:1);number++){const chapter=await write('/api/chapters',{bookId:book.id,title:`缓存章 ${number}`,chapter_number:number,content:`缓存测试正文 第${number}章`});expect(chapter.ok()).toBe(true);book.chapterIds.push((await chapter.json()).id);}
    }
    await page.goto(`${base}/book/${books[0].id}/${books[0].chapterIds[0]}`);
    const cache=page.locator('[data-reader-cache-chapters]');
    for(let number=1;number<=30;number++){
      if(number>1){await page.getByRole('button',{name:'下一章',exact:true}).click();await expect(page).toHaveURL(`${base}/book/${books[0].id}/${books[0].chapterIds[number-1]}`);}
      await expect(page.getByRole('heading',{name:`第${number}章 缓存章 ${number}`,exact:true})).toBeVisible();
      expect(Number(await cache.getAttribute('data-reader-cache-chapters'))).toBeLessThanOrEqual(20);
      if(number%10===0){await cdp.send('HeapProfiler.collectGarbage');samples.push({chapter:number,cache:Number(await cache.getAttribute('data-reader-cache-chapters')),dom:await cdp.send('Memory.getDOMCounters')});}
    }
    await expect(cache).toHaveAttribute('data-reader-cache-chapters','20');
    for(let index=1;index<books.length;index++){
      // Real Next links retain the loaded reader module and its caches between books.
      await page.locator('.reader-return:visible').click();
      await page.locator('a[href="/"]:visible').first().click();
      await page.locator(`a[href="/book/${books[index].id}"]:visible:not(.sr-only a)`).first().click({timeout:10000});
      await page.getByRole('link',{name:'开始阅读',exact:true}).filter({visible:true}).first().click({timeout:10000});
      await expect(page).toHaveURL(`${base}/book/${books[index].id}/${books[index].chapterIds[0]}`);
      await expect(page.getByRole('heading',{name:'第1章 缓存章 1',exact:true})).toBeVisible();
      expect(Number(await cache.getAttribute('data-reader-cache-books'))).toBeLessThanOrEqual(3);
      expect(Number(await cache.getAttribute('data-reader-cache-chapters'))).toBeLessThanOrEqual(20);
      samples.push({book:index+1,books:Number(await cache.getAttribute('data-reader-cache-books')),chapters:Number(await cache.getAttribute('data-reader-cache-chapters'))});
    }
    await expect(cache).toHaveAttribute('data-reader-cache-books','3');
    await fs.writeFile('../artifacts/cache-browser-report.json',JSON.stringify({result:'passed',distinctChapters:34,distinctBooks:5,samples,limits:'Counts read from actual Map sizes at render; sampled DOM counters do not prove absence of every browser leak'},null,2));
  }finally{
    for(const book of books){const csrf=await (await page.request.get(base+'/api/auth/csrf')).json();expect((await page.request.delete(base+'/api/books/'+book.id,{headers:{origin:base,'x-csrf-token':csrf.csrfToken}})).status()).toBe(200);}
  }
});
