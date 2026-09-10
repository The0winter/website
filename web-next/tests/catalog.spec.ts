import {test, expect} from '@playwright/test';
import mongoose from 'mongoose';

const base='http://127.0.0.1:3000';
const bookId=new mongoose.Types.ObjectId();
const chapterIds=Array.from({length:1238},()=>new mongoose.Types.ObjectId());
let database: mongoose.Connection;

test.beforeAll(async()=>{
  database=await mongoose.createConnection('mongodb://127.0.0.1:27028/test1_dev?replicaSet=testset',{serverSelectionTimeoutMS:5000}).asPromise();
  // Only add fixtures to the synthetic server/dev.js database.
  const seed=await database.collection('books').findOne({_id:new mongoose.Types.ObjectId('000000000000000000000101')});
  if(seed?.title!=='隔离测试：山海行记')throw Error('Synthetic development fixture required');
  await database.collection('books').insertOne({_id:bookId,title:'目录性能测试',description:'本地合成目录',author:'隔离作者',deletedAt:null,writeVersion:0,lastUpdated:new Date('2026-09-09T18:30:00Z')});
  await database.collection('chapters').insertMany(chapterIds.map((_id,index)=>({_id,bookId,title:`第${index+1}章 目录验证`,chapter_number:index+1,word_count:30,content:'目录回归的合成正文。',deletedAt:null,published_at:new Date()})));
});
test.afterAll(async()=>{
  if(database){
    await database.collection('chapters').deleteMany({bookId});
    await database.collection('books').deleteOne({_id:bookId});
    await database.close();
  }
});
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
});

test('book statistics are complete in the first HTML and stable across hydration, paging and sorting',async({browser})=>{
  // Both clients disagree with the server's default locale and with the site's date timezone.
  for(const settings of [
    {locale:'en-US',timezoneId:'America/Los_Angeles',viewport:{width:1440,height:900}},
    {locale:'de-DE',timezoneId:'Europe/Berlin',viewport:{width:390,height:844}},
  ]){
    const context=await browser.newContext(settings);
    const page=await context.newPage();
    const hydrationErrors:string[]=[];
    page.on('pageerror',error=>{if(/hydrat|#418/i.test(error.message))hydrationErrors.push(error.message);});
    await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    await page.route(`**/api/books/${bookId}/chapters*`,async route=>{
      if(Number(new URL(route.request().url()).searchParams.get('page'))>1)await gate;
      await route.continue();
    });
    try{
      const response=await page.goto(`${base}/book/${bookId}`);
      const html=await response!.text();
      expect(html).toContain('3.71万字');
      expect(html).toContain('2026/9/10');
      const words=page.getByText('连载中 | 3.71万字',{exact:true});
      const date=page.getByText('2026/9/10',{exact:true}).filter({visible:true});
      await expect(page.getByRole('region',{name:'章节目录'})).toHaveAttribute('aria-busy','true');
      await expect(words).toBeVisible();
      await expect(date).toHaveCount(1);
      release();
      await expect(page.getByRole('region',{name:'章节目录'})).toHaveAttribute('aria-busy','false');
      await page.getByRole('button',{name:'倒序',exact:true}).click();
      await expect(words).toBeVisible();
      await expect(date).toHaveCount(1);
      expect(hydrationErrors).toEqual([]);
    }finally{release();await context.close();}
  }
});

test('detail shows latest chapters first and keeps links stable while older pages arrive',async({page})=>{
  const requested:number[]=[];
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/books/${bookId}/chapters*`,async route=>{
    const url=new URL(route.request().url());
    expect(url.searchParams.get('order')).toBe('desc');
    const pageNumber=Number(url.searchParams.get('page'));
    requested.push(pageNumber);
    if(pageNumber>1)await gate;
    await route.continue();
  });
  await page.route('**/api/auth/session',async route=>{
    await new Promise(resolve=>setTimeout(resolve,500));
    await route.fulfill({json:{user:{id:'000000000000000000000001',username:'隔离作者',role:'reader'},profile:{id:'000000000000000000000001',username:'隔离作者'}}});
  });
  try{
    await page.goto(`${base}/book/${bookId}`);
    const latest=page.getByRole('link',{name:'第1238章 目录验证',exact:true});
    await expect(latest).toBeVisible();
    await expect(latest).toHaveAttribute('href',`/book/${bookId}/${chapterIds[1237]}`);
    await expect(page.getByRole('link',{name:'开始阅读',exact:true}).filter({visible:true})).toHaveAttribute('href',`/book/${bookId}/${chapterIds[0]}`);
    await expect(page.getByRole('region',{name:'章节目录'})).toHaveAttribute('aria-busy','true');
    await expect(page.getByText(/已加载|继续加载中/)).toHaveCount(0);
    await expect.poll(()=>requested.length).toBe(3);
    expect(requested).toEqual([2,3,4]);
    await page.getByRole('button',{name:'查看完整目录 (1238章)'}).click();
    await expect(page.getByRole('heading',{name:'全部目录'})).toBeVisible();
    await expect(page.getByText(/已加载|继续加载中/)).toHaveCount(0);
    await expect(latest).toHaveCount(2);
    await expect(latest.last()).toBeVisible();
    const latestPosition=await latest.last().boundingBox();
    release();
    await expect(page.getByRole('region',{name:'章节目录'})).toHaveAttribute('aria-busy','false');
    expect(await latest.last().boundingBox()).toEqual(latestPosition);
    await expect(latest.first()).toHaveAttribute('href',`/book/${bookId}/${chapterIds[1237]}`);
    expect(requested.slice().sort((a,b)=>a-b)).toEqual([2,3,4,5,6,7]);
    await page.unroute(`**/api/books/${bookId}/chapters*`);
    await latest.last().click();
    await expect(page).toHaveURL(`${base}/book/${bookId}/${chapterIds[1237]}`);
  }finally{release();}
});

test('changing sort during loading starts from the matching end and ignores late opposite pages',async({page})=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const requested:{order:string|null;page:number}[]=[];
  await page.route(`**/api/books/${bookId}/chapters*`,async route=>{
    const url=new URL(route.request().url());
    const order=url.searchParams.get('order'),pageNumber=Number(url.searchParams.get('page'));
    requested.push({order,page:pageNumber});
    if(order==='desc'&&pageNumber>1)await gate;
    await route.continue();
  });
  try{
    await page.goto(`${base}/book/${bookId}`);
    await expect(page.getByRole('link',{name:'第1238章 目录验证',exact:true})).toBeVisible();
    await expect.poll(()=>requested.length).toBe(3);
    await page.getByRole('button',{name:'倒序',exact:true}).click();
    await expect(page.getByRole('link',{name:'第1章 目录验证',exact:true})).toBeVisible();
    await expect(page.getByRole('region',{name:'章节目录'})).toHaveAttribute('aria-busy','false');
    release();
    await expect(page.getByRole('link',{name:'第1章 目录验证',exact:true})).toHaveAttribute('href',`/book/${bookId}/${chapterIds[0]}`);
    const finishedRequests=requested.length;
    await page.getByRole('button',{name:'正序',exact:true}).click();
    await expect(page.getByRole('link',{name:'第1238章 目录验证',exact:true})).toBeVisible();
    expect(requested.length).toBe(finishedRequests);
    expect(requested.filter(item=>item.order==='desc').map(item=>item.page)).toEqual([2,3,4]);
    await page.getByRole('link',{name:'开始阅读',exact:true}).filter({visible:true}).click();
    await expect(page).toHaveURL(`${base}/book/${bookId}/${chapterIds[0]}`);
  }finally{release();}
});

test('reader shows the first batch, surfaces errors, retries, and keeps its catalog across chapter changes',async({page})=>{
  const requested:number[]=[];
  let fail=true;
  await page.route(`**/api/books/${bookId}/chapters*`,async route=>{
    const pageNumber=Number(new URL(route.request().url()).searchParams.get('page'));
    requested.push(pageNumber);
    if(fail&&pageNumber>1){await route.fulfill({status:503,json:{error:'controlled catalog failure'}});return;}
    await route.continue();
  });
  await page.goto(`${base}/book/${bookId}/${chapterIds[0]}`);
  await page.getByRole('button',{name:'目录',exact:true}).click();
  await expect(page.getByRole('button',{name:'第1章 目录验证',exact:true})).toBeVisible();
  await expect(page.getByRole('alert').filter({hasText:'目录暂不可用'})).toBeVisible();
  fail=false;
  await page.getByRole('button',{name:'重试',exact:true}).click();
  await expect(page.getByRole('button',{name:'第1238章 目录验证',exact:true})).toBeAttached();
  await expect(page.getByRole('region',{name:'阅读目录'})).toHaveAttribute('aria-busy','false');
  await expect(page.getByText(/已加载|继续加载中/)).toHaveCount(0);
  const requestsAfterLoad=requested.length;
  await page.getByRole('button',{name:'第1章 目录验证',exact:true}).click();
  await page.getByRole('button',{name:'下一章',exact:true}).click();
  await expect(page).toHaveURL(`${base}/book/${bookId}/${chapterIds[1]}`);
  await expect(page.getByRole('heading',{name:'第2章 目录验证',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'目录',exact:true}).click();
  await expect(page.getByRole('button',{name:'第1238章 目录验证',exact:true})).toBeAttached();
  expect(requested.length).toBe(requestsAfterLoad);
  // A publication changes writeVersion, so a subsequent chapter must refresh.
  const addedId=new mongoose.Types.ObjectId();
  await database.collection('chapters').insertOne({_id:addedId,bookId,title:'第1239章 新章节',chapter_number:1239,content:'合成新章节',deletedAt:null});
  await database.collection('books').updateOne({_id:bookId},{$inc:{writeVersion:1}});
  try{
    await page.getByRole('button',{name:'第3章 目录验证',exact:true}).click();
    await expect(page).toHaveURL(`${base}/book/${bookId}/${chapterIds[2]}`);
    await page.getByRole('button',{name:'目录',exact:true}).click();
    await expect(page.getByRole('button',{name:'第1239章 新章节',exact:true})).toBeAttached();
    expect(requested.length).toBeGreaterThan(requestsAfterLoad);
  }finally{
    await database.collection('chapters').deleteOne({_id:addedId});
    await database.collection('books').updateOne({_id:bookId},{$inc:{writeVersion:1}});
  }
});

test('a deep chapter never navigates to chapter one while later catalog pages are pending',async({page})=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/books/${bookId}/chapters*`,async route=>{
    if(Number(new URL(route.request().url()).searchParams.get('page'))>1)await gate;
    await route.continue();
  });
  try{
    await page.goto(`${base}/book/${bookId}/${chapterIds[999]}`);
    await expect(page.getByRole('button',{name:'下一章',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'下一章',exact:true}).click();
    await expect(page).toHaveURL(`${base}/book/${bookId}/${chapterIds[1000]}`);
    await expect(page.getByRole('heading',{name:'第1001章 目录验证',exact:true})).toBeVisible();
  }finally{release();}
});
