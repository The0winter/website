import {test, expect} from '@playwright/test';
import mongoose from 'mongoose';
import {formatRelativeUpdate} from '../lib/relative-update';

const base=process.env.TEST_SITE_URL || 'http://127.0.0.1:3000';
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

test('detail catalog locates remembered progress after older chapter batches arrive',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(({book,chapter})=>localStorage.setItem('reader-recent-chapters:v1',JSON.stringify([[book,chapter]])),{book:String(bookId),chapter:String(chapterIds[999])});
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/books/${bookId}/chapters*`,async route=>{
    if(Number(new URL(route.request().url()).searchParams.get('page'))>1)await gate;
    await route.continue();
  });
  try{
    await page.goto(`${base}/book/${bookId}`);
    await page.getByRole('button',{name:/^目录 /}).click();
    const dialog=page.getByRole('dialog',{name:'全部目录'});
    await expect(dialog.locator('[aria-current="location"]')).toHaveCount(0);
    release();
    const current=dialog.locator('[aria-current="location"]');
    await expect(current).toHaveText('第1000章 目录验证上次读到');
    await expect(current).toBeInViewport();
    await expect(dialog.getByRole('button',{name:/正序|倒序/})).toHaveCount(0);
    await dialog.getByRole('button',{name:'关闭目录'}).click();
    await page.getByRole('button',{name:/^目录 /}).click();
    await expect(current).toBeInViewport();
  }finally{release();}
});

test('book statistics are complete in the first HTML and stable across hydration, paging and opening the catalog',async({browser})=>{
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
      const updatedLabel=formatRelativeUpdate('2026-09-09T18:30:00Z');
      expect(html).toContain(updatedLabel);
      const words=page.getByText('连载中 | 3.71万字',{exact:true});
      const date=page.getByText(updatedLabel,{exact:false}).filter({visible:true});
      await expect(page.getByRole('region',{name:'章节目录'})).toHaveAttribute('aria-busy','true');
      await expect(words).toBeVisible();
      await expect(date).toHaveCount(1);
      release();
      await expect(page.getByRole('region',{name:'章节目录'})).toHaveAttribute('aria-busy','false');
      await page.getByRole('button',{name:settings.viewport.width < 768 ? /^目录 / : /^查看完整目录/}).click();
      await expect(page.getByRole('dialog').getByRole('button',{name:/正序|倒序/})).toHaveCount(0);
      await expect(words).toBeVisible();
      await expect(date).toHaveCount(1);
      expect(hydrationErrors).toEqual([]);
    }finally{release();await context.close();}
  }
});

test('detail keeps recent updates outside an ascending catalog as later pages arrive',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const requested:number[]=[];
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/books/${bookId}/chapters*`,async route=>{
    const url=new URL(route.request().url());
    expect(url.searchParams.get('order')).toBe('asc');
    requested.push(Number(url.searchParams.get('page')));
    if(Number(url.searchParams.get('page'))>1)await gate;
    await route.continue();
  });
  try{
    await page.goto(`${base}/book/${bookId}`);
    const latest=page.locator('.book-catalog').getByRole('link',{name:'第1238章 目录验证',exact:true});
    await expect(latest).toBeVisible();
    await expect(page.getByRole('link',{name:'开始阅读',exact:true}).filter({visible:true})).toHaveAttribute('href',`/book/${bookId}/${chapterIds[0]}`);
    await page.getByRole('button',{name:'查看完整目录 (1238章)'}).click();
    const dialog=page.getByRole('dialog',{name:'全部目录'});
    const first=dialog.getByRole('link',{name:'第1章 目录验证',exact:true});
    await expect(first).toBeVisible();
    await expect(dialog.getByRole('button',{name:/正序|倒序/})).toHaveCount(0);
    await expect.poll(()=>requested.length).toBe(4);
    const position=await first.boundingBox();
    release();
    await expect(dialog.getByRole('region')).toHaveAttribute('aria-busy','false');
    expect(await first.boundingBox()).toEqual(position);
    expect(requested.slice().sort((a,b)=>a-b)).toEqual([1,2,3,4,5,6,7]);
    await page.unroute(`**/api/books/${bookId}/chapters*`);
    await first.click();
    await expect(page).toHaveURL(`${base}/book/${bookId}/${chapterIds[0]}`);
  }finally{release();}
});

for(const width of [320,390,768,1440]){
  test(`long detail catalog supports dragging, touch scrolling and keyboard navigation at ${width}px`,async({browser})=>{
    const context=await browser.newContext({viewport:{width,height:844},hasTouch:true});
    const page=await context.newPage();
    const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${base}/book/${bookId}`);
    await page.getByRole('button',{name:width<768?/^目录 /:/^查看完整目录/}).click();
    const dialog=page.getByRole('dialog',{name:'全部目录'});
    await expect(dialog.getByRole('region')).toHaveAttribute('aria-busy','false');
    const bar=dialog.getByRole('scrollbar',{name:'快速滚动目录'});
    await expect(bar).toBeVisible();
    await expect.poll(()=>dialog.evaluate(el=>getComputedStyle(el).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
    const track=(await bar.boundingBox())!;
    const thumb=(await bar.locator('.book-catalog-thumb').boundingBox())!;
    await page.mouse.move(thumb.x+thumb.width/2,thumb.y+thumb.height/2);
    await page.mouse.down();
    await page.mouse.move(track.x+track.width/2,track.y+track.height/2,{steps:8});
    await page.mouse.up();
    const list=dialog.locator('.book-catalog-list');
    await expect.poll(()=>list.evaluate(el=>el.scrollTop/(el.scrollHeight-el.clientHeight))).toBeGreaterThan(.4);
    await expect.poll(()=>list.evaluate(el=>el.scrollTop/(el.scrollHeight-el.clientHeight))).toBeLessThan(.6);
    const cdp=await context.newCDPSession(page);
    const touchThumb=(await bar.locator('.book-catalog-thumb').boundingBox())!;
    const x=touchThumb.x+touchThumb.width/2, y=touchThumb.y+touchThumb.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:track.y+track.height+30}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(dialog.getByRole('link',{name:'第1238章 目录验证',exact:true})).toBeInViewport();
    await expect(bar).toHaveAttribute('data-dragging','false');
    await bar.focus(); await page.keyboard.press('Home');
    await expect(dialog.getByRole('link',{name:'第1章 目录验证',exact:true})).toBeInViewport();
    const listBox=(await list.boundingBox())!;
    const touchX=listBox.x+listBox.width/2, touchY=listBox.y+listBox.height*.7;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchX,y:touchY}]});
    for(let i=1;i<=5;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchX,y:touchY-i*40}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(()=>list.evaluate(el=>el.scrollTop)).toBeGreaterThan(50);
    await expect.poll(()=>bar.getAttribute('aria-valuenow').then(Number)).toBeGreaterThan(0);
    await bar.focus(); await page.keyboard.press('End');
    await expect(dialog.getByRole('link',{name:'第1238章 目录验证',exact:true})).toBeInViewport();
    expect(await dialog.locator('.book-catalog-chapter').count()).toBeLessThan(90);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`../artifacts/mobile-catalog-${width}.png`});
    await page.goBack(); await expect(dialog).not.toBeVisible();
    await page.getByRole('button',{name:width<768?/^目录 /:/^查看完整目录/}).click();
    await expect(dialog.getByRole('link',{name:'第1章 目录验证',exact:true})).toBeInViewport();
    expect(errors).toEqual([]);
    await context.close();
  });
}

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
