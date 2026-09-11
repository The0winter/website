import {test, expect, type Page} from '@playwright/test';
import mongoose from 'mongoose';

const base='http://127.0.0.1:3000';
const book=new mongoose.Types.ObjectId(), extrasBook=new mongoose.Types.ObjectId();
const ids=Array.from({length:373},()=>new mongoose.Types.ObjectId());
let db: mongoose.Connection;
const labels=['第一卷 原篇（作者：甲）','第二卷 续篇（作者：乙）','第三卷 番外篇'];

test.beforeAll(async()=>{
  db=await mongoose.createConnection('mongodb://127.0.0.1:27028/test1_dev?replicaSet=testset',{serverSelectionTimeoutMS:5000}).asPromise();
  const seed=await db.collection('books').findOne({_id:new mongoose.Types.ObjectId('000000000000000000000101')});
  if(seed?.title!=='隔离测试：山海行记')throw Error('Synthetic development fixture required');
  await db.collection('books').insertMany([{_id:book,title:'分卷目录测试',author:'隔离作者',deletedAt:null,writeVersion:0},{_id:extrasBook,title:'正文与番外',deletedAt:null,writeVersion:0}]);
  await db.collection('chapters').insertMany(ids.map((_id,index)=>{
    const group=index<86?0:index<332?1:2, local=index-[0,86,332][group];
    return {_id,bookId:book,title:`${labels[group]} 第${local+1}章 第${index+1}次旅程`,chapter_number:index+1,content:'山间的风吹过树林，旅人继续前行。\n\n'.repeat(80),word_count:2000,deletedAt:null};
  }));
  await db.collection('chapters').insertMany(['番外一 重逢','番外二 出发','正文 第1章 开始','正文 第2章 继续'].map((title,index)=>({bookId:extrasBook,title,chapter_number:index+1,content:'隔离测试正文。'.repeat(100),deletedAt:null})));
});
test.afterAll(async()=>{
  if(db){await db.collection('chapters').deleteMany({bookId:{$in:[book,extrasBook]}});await db.collection('books').deleteMany({_id:{$in:[book,extrasBook]}});await db.close();}
});
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.addInitScript(()=>localStorage.setItem('has-seen-reading-hint','true'));
});
const open = async(page: Page, origin: string, width: number)=>{
  if(origin==='detail')await page.getByRole('button',{name:width<768?/^目录 /:/^查看完整目录/}).click();
  else {
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready','true');
    await page.keyboard.press('m');await page.locator('.reader-tools:visible').getByRole('button',{name:'目录',exact:true}).click();
  }
  await expect(page.locator('.book-catalog-scroll-area')).toHaveAttribute('data-ready','true');
};

for(const width of [390,1440])for(const scenario of ['first-detail','saved-detail','reader'])test(`${scenario} folds volumes and restores the actual reading volume at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:844});
  const active=scenario==='first-detail'?undefined:String(ids[210]);
  if(active)await page.addInitScript(({book,active})=>localStorage.setItem('reader-recent-chapters:v1',JSON.stringify([[book,active]])),{book:String(book),active});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/book/${book}${scenario==='reader'?'/'+active:''}`);
  await open(page,scenario==='reader'?'reader':'detail',width);
  const dialog=page.getByRole('dialog',{name:'全部目录'});
  await expect(dialog.locator('.book-catalog-volume-tools')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'收起全部',exact:true})).toHaveCount(0);
  if(active)await expect(dialog.locator('[aria-current="location"]')).toHaveAttribute('href',`/book/${book}/${active}`);
  else await expect(dialog.getByRole('button',{name:new RegExp(labels[0].replace(/[（）]/g,'.'))})).toHaveAttribute('aria-expanded','true');
  if(active)await expect(dialog.locator('[aria-current="location"]')).toBeInViewport();
  await dialog.locator('.book-catalog-list').evaluate(element=>{element.scrollTop=0;});
  await dialog.locator('.book-catalog-volume-toggle[aria-expanded=true]').click();
  await expect(dialog.locator('.book-catalog-scroll-area')).toHaveAttribute('data-ready','true');
  const headers=dialog.locator('.book-catalog-volume-toggle');
  await expect(headers).toHaveCount(3);
  for(const header of await headers.all())await expect(header).toHaveAttribute('aria-expanded','false');
  await expect(dialog.locator('.book-catalog-chapter')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('collapsed.png')});
  const second=dialog.getByRole('button',{name:/第二卷 续篇/});
  await second.click();
  await expect(dialog.locator('.book-catalog-scroll-area')).toHaveAttribute('data-ready','true');
  await expect(second).toHaveAttribute('aria-expanded','true');
  await expect(second).toBeFocused();
  const start=dialog.locator(`a[href="/book/${book}/${ids[86]}"]`);
  await expect(start).toHaveText('第1章 第87次旅程');
  await expect(start).toBeInViewport();
  expect(await dialog.locator('.book-catalog-chapter').count()).toBeLessThan(80);
  await page.screenshot({path:testInfo.outputPath('second-volume.png')});
  await second.click();
  await expect(second).toHaveAttribute('aria-expanded','false');
  await expect(dialog.locator('.book-catalog-chapter')).toHaveCount(0);
  await second.click();await expect(start).toBeInViewport();await start.click();
  await expect(page).toHaveURL(`${base}/book/${book}/${ids[86]}`);
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready','true');
  await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
  await open(page,'reader',width);
  await expect(dialog.locator('[aria-current="location"]')).toHaveAttribute('href',`/book/${book}/${ids[86]}`);
  await expect(dialog.locator('.book-catalog-volume-toggle[aria-expanded=true]')).toHaveCount(1);
  await expect(dialog.locator('.book-catalog-volume-toggle[aria-expanded=true]')).toContainText('第二卷');
  await page.goBack();await expect(dialog).not.toBeVisible();
  await page.goBack();await expect(page).toHaveURL(`${base}/book/${book}`);
  await open(page,'detail',width);
  await expect(dialog.locator('[aria-current="location"]')).toHaveAttribute('href',`/book/${book}/${ids[86]}`);
  await expect(dialog.locator('.book-catalog-volume-toggle[aria-expanded=true]')).toContainText('第二卷');
  expect(errors).toEqual([]);
});

test('without reading progress the body is preferred, while extras remain independently expandable',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${base}/book/${extrasBook}`);await open(page,'detail',390);
  const dialog=page.getByRole('dialog',{name:'全部目录'});
  const body=dialog.getByRole('button',{name:/^正文 /}),extras=dialog.getByRole('button',{name:/^番外 /});
  await expect(body).toHaveAttribute('aria-expanded','true');await expect(extras).toHaveAttribute('aria-expanded','false');
  await expect(dialog.getByRole('link',{name:'第1章 开始',exact:true})).toBeVisible();
  await extras.click();await expect(extras).toHaveAttribute('aria-expanded','true');await expect(body).toHaveAttribute('aria-expanded','true');
  await expect(dialog.getByRole('link',{name:'番外一 重逢',exact:true})).toBeVisible();
  await extras.click();await expect(extras).toHaveAttribute('aria-expanded','false');await expect(body).toHaveAttribute('aria-expanded','true');
});

for(const width of [320,390,768,1440])test(`folding stays visible and reuses cached rows even with a pending volume at ${width}px`,async({page,context},testInfo)=>{
  await page.setViewportSize({width,height:844});
  await page.addInitScript(()=>Object.defineProperty(navigator,'connection',{configurable:true,value:Object.assign(new EventTarget(),{saveData:true,effectiveType:'2g'})}));
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const requests:string[]=[];
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/books/${book}/catalog*`,async route=>{
    const url=new URL(route.request().url());requests.push(url.search);
    if(Number(url.searchParams.get('offset'))>0)await gate;
    await route.continue();
  });
  try{
    await page.goto(`${base}/book/${book}`);await open(page,'detail',width);
    const dialog=page.getByRole('dialog',{name:'全部目录'}),area=dialog.locator('.book-catalog-scroll-area');
    const scroller=await dialog.locator('.book-catalog-list').elementHandle();
    await area.evaluate(element=>{
      const region=element.closest('[aria-busy]')!;
      const trace={interruptions:0};
      const observer=new MutationObserver(()=>{
        if(!element.isConnected||region.getAttribute('aria-busy')!=='false'||element.getAttribute('data-ready')!=='true'||region.querySelector('[role=status]'))trace.interruptions++;
      });
      observer.observe(region.parentElement!,{childList:true,attributes:true,subtree:true});
      Object.assign(window,{foldTrace:{trace,observer}});
    });
    await dialog.locator('.book-catalog-volume-toggle[aria-expanded=true]').click();
    const last=dialog.getByRole('button',{name:/第三卷 番外篇/});
    const top=(await last.boundingBox())!.y;
    await last.click();await expect(last).toHaveAttribute('aria-expanded','true');
    await expect(dialog.locator('.book-catalog-placeholder').first()).toBeVisible();
    await expect(dialog.getByRole('status')).toHaveCount(0);
    await expect(dialog.getByRole('region',{name:'阅读目录'})).toHaveAttribute('aria-busy','false');
    expect(Math.abs((await last.boundingBox())!.y-top)).toBeLessThan(2);
    await last.click();await expect(last).toHaveAttribute('aria-expanded','false');
    await expect(dialog.locator('.book-catalog-placeholder')).toHaveCount(0);
    await last.click();await expect(dialog.locator('.book-catalog-placeholder').first()).toBeVisible();
    release();
    const start=dialog.locator(`a[href="/book/${book}/${ids[332]}"]`);
    await expect(start).toBeInViewport();
    await expect(dialog.locator('.book-catalog-placeholder')).toHaveCount(0);
    const requestCount=requests.length;
    // Once loaded, even rapid repeated folding must keep this same scroller
    // visible, preserve the header position, and issue no catalog requests.
    for(let repeat=0;repeat<5;repeat++){
      await last.click();await expect(last).toHaveAttribute('aria-expanded','false');
      await last.click();await expect(start).toBeInViewport();
      expect(Math.abs((await last.boundingBox())!.y-top)).toBeLessThan(2);
    }
    await last.focus();await page.keyboard.press('Enter');await expect(last).toHaveAttribute('aria-expanded','false');
    await page.keyboard.press('Space');await expect(last).toHaveAttribute('aria-expanded','true');
    await expect(last).toBeFocused();await expect(start).toBeInViewport();
    expect(requests).toHaveLength(requestCount);
    expect(await scroller!.evaluate(element=>element.isConnected)).toBe(true);
    const interruptions=await page.evaluate(()=>{
      const {trace,observer}=(window as unknown as {foldTrace:{trace:{interruptions:number};observer:MutationObserver}}).foldTrace;
      observer.disconnect();return trace.interruptions;
    });
    expect(interruptions).toBe(0);
    await page.screenshot({path:testInfo.outputPath('expanded-without-reloading.png')});
  }finally{release();}
});
