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

for (const origin of ['detail', 'reader']) for (const width of [390, 1440]) test(`${origin} opens directly at chapter 1000 while earlier windows are blocked at ${width}px`, async ({page, context}) => {
  await page.setViewportSize({width, height: 844});
  await page.addInitScript(({book, chapter}) => {
    localStorage.setItem('reader-recent-chapters:v1', JSON.stringify([[book, chapter]]));
    localStorage.setItem('has-seen-reading-hint', 'true');
  }, {book: String(bookId), chapter: String(chapterIds[999])});
  const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', {rate: 4});
  let targetRelease!: () => void, backgroundRelease!: () => void;
  const targetGate = new Promise<void>(resolve => {targetRelease = resolve;}), backgroundGate = new Promise<void>(resolve => {backgroundRelease = resolve;});
  const requests: URL[] = [];
  await page.route(`**/api/books/${bookId}/catalog*`, async route => {
    const url = new URL(route.request().url()); requests.push(url);
    if (url.searchParams.has('anchor')) await targetGate;
    else if (url.searchParams.get('offset') === '0') await backgroundGate;
    await route.continue();
  });
  try {
    await page.goto(`${base}/book/${bookId}${origin === 'reader' ? `/${chapterIds[999]}` : ''}`);
    const open = async () => {
      if (origin === 'detail') await page.getByRole('button', {name: width < 768 ? /^目录 / : /^查看完整目录/}).click();
      else {
        await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
        await page.keyboard.press('m'); await page.locator('.reader-tools:visible').getByRole('button', {name: '目录', exact: true}).click();
      }
    };
    await open(); const dialog = page.getByRole('dialog', {name: '全部目录'});
    await expect(dialog.getByRole('status')).toHaveText('加载目录…');
    await expect(dialog.locator('.book-catalog-chapter')).toHaveCount(0);
    await page.evaluate(() => {
      const state = {running: true, frames: [] as {current: boolean; top: number}[]}; Object.assign(window, {windowFrames: state});
      const sample = () => {
        const area = document.querySelector('.book-catalog-overlay[data-open=true] .book-catalog-scroll-area');
        if (area && getComputedStyle(area).opacity !== '0') {
          const list = area.querySelector('.book-catalog-list')!, target = area.querySelector('[aria-current]');
          const viewport = list.getBoundingClientRect(), item = target?.getBoundingClientRect();
          state.frames.push({current: Boolean(item && item.top >= viewport.top && item.bottom <= viewport.bottom), top: list.scrollTop});
        }
        if (state.running) requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    });
    targetRelease();
    const current = dialog.locator('[aria-current="location"]');
    await expect(dialog.locator('.book-catalog-scroll-area')).toHaveAttribute('data-ready', 'true');
    await expect(current).toHaveAttribute('href', `/book/${bookId}/${chapterIds[999]}`);
    await expect(current).toBeInViewport();
    await expect.poll(() => page.evaluate(() => (window as unknown as {windowFrames: {frames: unknown[]}}).windowFrames.frames.length)).toBeGreaterThan(8);
    const frames = await page.evaluate(() => {const state = (window as unknown as {windowFrames: {running: boolean; frames: {current: boolean; top: number}[]}}).windowFrames; state.running = false; return state.frames;});
    expect(frames.every(frame => frame.current)).toBe(true);
    expect(Math.max(...frames.map(frame => frame.top)) - Math.min(...frames.map(frame => frame.top))).toBeLessThan(2);
    expect(requests[0].searchParams.get('anchor')).toBe(String(chapterIds[999]));
    expect(Number(requests[0].searchParams.get('limit'))).toBe(128);
    // Dragging to an unloaded tail uses the other request slot while the prefix remains blocked.
    await dialog.getByRole('scrollbar').focus(); await page.keyboard.press('End');
    await expect(dialog.getByRole('link', {name: '第1238章 目录验证', exact: true})).toBeInViewport();
    expect(await dialog.locator('.book-catalog-chapter').count()).toBeLessThan(80);
    await dialog.getByRole('button', {name: '关闭目录'}).click(); await open();
    await expect(dialog.locator('.book-catalog-scroll-area')).toHaveAttribute('data-ready', 'true');
    await expect(current).toBeInViewport();
    backgroundRelease();
    await dialog.locator(`a[href="/book/${bookId}/${chapterIds[1000]}"]`).click();
    await expect(page).toHaveURL(`${base}/book/${bookId}/${chapterIds[1000]}`);
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
    await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
    await page.keyboard.press('m'); await page.locator('.reader-tools:visible').getByRole('button', {name: '目录', exact: true}).click();
    await expect(dialog.locator('[aria-current]')).toHaveAttribute('href', `/book/${bookId}/${chapterIds[1000]}`);
    expect(requests.filter(url => url.searchParams.has('anchor'))).toHaveLength(1);
  } finally {targetRelease(); backgroundRelease();}
});

test('a missing remembered chapter retries and falls back after the server resolves it', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.addInitScript(({book, id}) => localStorage.setItem('reader-recent-chapters:v1', JSON.stringify([[book, id]])), {book: String(bookId), id: String(new mongoose.Types.ObjectId())});
  let fail = true;
  await page.route(`**/api/books/${bookId}/catalog*`, route => fail ? route.fulfill({status: 503, json: {error: 'controlled failure'}}) : route.continue());
  await page.goto(`${base}/book/${bookId}`); await page.getByRole('button', {name: /^目录 /}).click();
  const dialog = page.getByRole('dialog', {name: '全部目录'});
  await expect(dialog.getByRole('alert')).toBeVisible(); await expect(dialog.locator('.book-catalog-chapter')).toHaveCount(0);
  fail = false; await dialog.getByRole('button', {name: '重试'}).click();
  await expect(dialog.getByRole('link', {name: '第1章 目录验证', exact: true})).toBeInViewport();
  await expect(dialog.getByRole('region')).toHaveAttribute('aria-busy', 'false');
});

test('publication changes invalidate sparse positions without mixing old and new rows', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.addInitScript(({book, chapter}) => {
    localStorage.setItem('reader-recent-chapters:v1', JSON.stringify([[book, chapter]]));
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
  }, {book: String(bookId), chapter: String(chapterIds[999])});
  await page.goto(`${base}/book/${bookId}`); await page.getByRole('button', {name: /^目录 /}).click();
  const dialog = page.getByRole('dialog', {name: '全部目录'});
  await expect(dialog.locator('[aria-current]')).toBeInViewport();
  await database.collection('chapters').updateOne({_id: chapterIds[0]}, {$set: {deletedAt: new Date()}});
  await database.collection('books').updateOne({_id: bookId}, {$inc: {writeVersion: 1}});
  try {
    await dialog.locator('.book-catalog-list').evaluate(el => {el.scrollTop = el.scrollHeight * .2;});
    await expect(dialog.locator('.book-catalog-header')).toContainText('共 1237 章');
    await expect(dialog.locator('[aria-current]')).toBeInViewport();
    await dialog.getByRole('scrollbar').focus(); await page.keyboard.press('Home');
    await expect(dialog.getByRole('link', {name: '第2章 目录验证', exact: true})).toHaveAttribute('href', `/book/${bookId}/${chapterIds[1]}`);
    await expect(dialog.getByRole('link', {name: '第1章 目录验证', exact: true})).toHaveCount(0);
  } finally {
    await database.collection('chapters').updateOne({_id: chapterIds[0]}, {$set: {deletedAt: null}});
    await database.collection('books').updateOne({_id: bookId}, {$inc: {writeVersion: 1}});
  }
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
      const words=page.getByText('连载中 | 3.71万字',{exact:true}).filter({visible:true});
      const date=page.getByText(updatedLabel,{exact:false}).filter({visible:true});
      await expect(page.getByRole('region',{name:'章节目录'})).toHaveAttribute('aria-busy','false');
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
