import {test, expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';
import type {ForumPost} from '../lib/api';

const base = process.env.DETAIL_BASE || 'http://127.0.0.1:3000';
const book = process.env.DETAIL_BOOK || '000000000000000000000101';
const detail = `${base}/book/${book}`;
const posts = (count:number, offset = 0):ForumPost[] => Array.from({length:count}, (_, i) => ({
  id:(4096 + offset + i).toString(16).padStart(24, '0'), title:`第 ${offset + i + 1} 篇：山海之间的阅读记忆`,
  excerpt:'那些看似平常的片段，藏着人物一路走来的变化。'.repeat(i + 1), author:{id:'reader',name:'山间书友'},
  type:'article', votes:12, comments:3, tags:[], isHot:false,
}));

test.use({hasTouch:true, colorScheme:'light'});
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value:{saveData:true, addEventListener(){}, removeEventListener(){}}});
    localStorage.setItem('has-seen-reading-hint', 'true');
  });
  await page.route('**/api/auth/session', route => route.fulfill({json:{user:null,profile:null}}));
  await page.route('**/api/books/*/views', route => route.fulfill({json:{success:true,counted:false}}));
  await page.route('**/api/books/*/reviews?*', route => route.fulfill({json:[{
    _id:'000000000000000000000201', rating:4, content:'评论独立保留，切换文章仍然可以阅读。',
    user:{_id:'reader',username:'书友'}, createdAt:'2026-09-20T12:00:00Z',
  }], headers:{'X-Total-Count':'1','X-Next-Cursor':''}}));
  await page.route('**/api/books/*/review-reactions?*', route => route.fulfill({json:[]}));
});

async function mockArticles(page:Page, count:number) {
  await page.route('**/api/books/*/discussions?*', route => route.fulfill({json:{items:posts(count),total:count}}));
}

async function activeSlide(page:Page) {
  return page.locator('.book-article-track').evaluate(track => {
    const rect = track.getBoundingClientRect();
    return [...track.children].flatMap((slide,index) => {
      const box = slide.getBoundingClientRect();
      return Math.min(box.right, rect.right) - Math.max(box.left, rect.left) > 1 ? [index] : [];
    });
  });
}

// Send native Chromium touch input: exercise browser scrolling and snapping,
// rather than dispatching synthetic DOM handlers or assigning scrollLeft.
async function swipe(page:Page, direction:'left'|'right'|'down') {
  const track = page.locator('.book-article-track');
  await track.scrollIntoViewIfNeeded();
  const box = (await track.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  const startX = box.x + box.width * (direction === 'right' ? .2 : .8);
  const y = Math.min(box.y + box.height * (direction === 'down' ? .25 : .65), page.viewportSize()!.height - 180);
  const distance = direction === 'down' ? 0 : box.width * .6 * (direction === 'left' ? -1 : 1);
  try {
    await session.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x:startX,y}]});
    for (let step=1; step<=12; step++) {
      await session.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:startX+distance*step/12,y:y+(direction==='down'?120*step/12:0)}]});
      await page.waitForTimeout(16);
    }
    await session.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  } finally { await session.detach(); }
}

for (const width of [320,390,430,767]) test(`mobile ${width}: independent reviews and one article per native swipe`, async ({page}, info) => {
  await page.setViewportSize({width,height:844});
  await mockArticles(page,3);
  const errors:string[]=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.goto(detail);
  const articles=page.getByRole('region',{name:'文章',exact:true});
  const reviews=page.locator('#reviews-section');
  const counter=articles.locator('[aria-live=polite]');
  await expect(reviews.locator('.book-review')).toHaveCount(1);
  await expect(articles.locator('.forum-entry')).toHaveCount(3);
  await expect(page.getByRole('tablist',{name:'书友交流'})).toHaveCount(0);
  expect(await reviews.locator('#articles-section').count()).toBe(0);
  expect((await articles.boundingBox())!.y).toBeGreaterThan((await reviews.boundingBox())!.y+(await reviews.boundingBox())!.height);
  await expect.poll(()=>activeSlide(page)).toEqual([0]);
  await expect(articles.getByRole('button',{name:'上一篇文章'})).toBeDisabled();
  await swipe(page,'left');
  await expect(counter).toHaveText('2 / 3');
  await expect.poll(()=>activeSlide(page)).toEqual([1]);
  await swipe(page,'left');
  await expect(counter).toHaveText('3 / 3');
  await expect.poll(()=>activeSlide(page)).toEqual([2]);
  await expect(articles.getByRole('button',{name:'下一篇文章'})).toBeDisabled();
  await swipe(page,'left');
  await expect.poll(()=>activeSlide(page)).toEqual([2]);
  await swipe(page,'right');
  await expect(counter).toHaveText('2 / 3');
  await expect.poll(()=>activeSlide(page)).toEqual([1]);
  await expect(reviews.locator('.book-review-content')).toHaveText('评论独立保留，切换文章仍然可以阅读。');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
  await reviews.getByRole('button',{name:'查看全部评论'}).click();
  await expect(page.getByRole('dialog',{name:'全部评论',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'全部评论',exact:true})).toHaveCount(0);
  await expect(counter).toHaveText('2 / 3');
  await articles.evaluate(element=>element.scrollIntoView({block:'center'}));
  await page.screenshot({path:info.outputPath(`verified-detail-${width}.png`)});
  await articles.screenshot({path:info.outputPath(`verified-articles-${width}.png`)});
  expect(errors).toEqual([]);
});

for (const count of [0,1]) test(`mobile boundary: ${count} article has no switching controls`, async ({page},info) => {
  await page.setViewportSize({width:390,height:844});
  await mockArticles(page,count);
  await page.goto(detail);
  const section=page.locator('#articles-section');
  await expect(section.locator('.forum-entry-list')).toHaveAttribute('aria-busy','false');
  await expect(section.locator('.forum-entry')).toHaveCount(count);
  await expect(section.getByRole('navigation')).toHaveCount(0);
  if (!count) await expect(section).toContainText('还没有相关文章');
  else {
    await swipe(page,'left');
    await expect.poll(()=>activeSlide(page)).toEqual([0]);
    await expect(section.locator('.forum-entry-title')).toHaveAttribute('href',`/forum/${posts(1)[0].id}`);
  }
  await section.screenshot({path:info.outputPath(`verified-${count}-article.png`)});
});

test('mobile controls, keyboard, vertical scrolling and resize keep the current slide aligned', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await mockArticles(page,3);
  await page.goto(detail);
  await page.getByRole('button',{name:'下一篇文章'}).click();
  await expect.poll(()=>activeSlide(page)).toEqual([1]);
  const track=page.locator('.book-article-track');
  await track.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(()=>activeSlide(page)).toEqual([2]);
  await page.setViewportSize({width:430,height:844});
  await expect.poll(()=>activeSlide(page)).toEqual([2]);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('button',{name:'上一篇文章'}).click();
  await expect.poll(()=>activeSlide(page)).toEqual([1]);
  await track.scrollIntoViewIfNeeded();
  const before=await page.evaluate(()=>scrollY);
  await swipe(page,'down');
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeLessThan(before-40);
  await expect.poll(()=>activeSlide(page)).toEqual([1]);
});

test('article loading, failure and retry do not hide reviews; a new page starts at its first article', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  let fail=true;
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/books/*/discussions?*',async route=>{
    await gate;
    if (fail) return route.fulfill({status:400,json:{error:'fixture'}});
    const second=new URL(route.request().url()).searchParams.get('page')==='2';
    return route.fulfill({json:{items:posts(second?1:20,second?20:0),total:21}});
  });
  await page.goto(detail);
  const section=page.locator('#articles-section');
  await expect(section.getByRole('status')).toBeVisible();
  await expect(page.locator('#reviews-section .book-review')).toHaveCount(1);
  release();
  await expect(section.getByRole('alert')).toContainText('讨论加载失败');
  fail=false;
  await section.getByRole('button',{name:'重试',exact:true}).click();
  await expect(section.locator('.forum-entry')).toHaveCount(20);
  await section.getByRole('button',{name:'下一篇文章'}).click();
  await expect.poll(()=>activeSlide(page)).toEqual([1]);
  const pagination=section.getByRole('navigation',{name:'文章分页'});
  await pagination.getByRole('button',{name:'下一页'}).click();
  await expect(section.locator('.forum-entry')).toHaveCount(1);
  await expect(section.locator('.forum-entry-title')).toContainText('第 21 篇');
  await expect.poll(()=>activeSlide(page)).toEqual([0]);
  await expect(pagination.getByRole('button',{name:'下一页'})).toBeDisabled();
  await pagination.getByRole('button',{name:'上一页'}).click();
  await expect(section.locator('.forum-entry')).toHaveCount(20);
  await expect.poll(()=>activeSlide(page)).toEqual([0]);
});

for (const width of [768,1440]) test(`desktop ${width}: articles stay in a vertical list with independent reviews`,async ({page},info)=>{
  await page.setViewportSize({width,height:900});
  await mockArticles(page,3);
  await page.goto(detail);
  const section=page.locator('#articles-section');
  await expect(section.locator('.forum-entry')).toHaveCount(3);
  await expect(section.getByRole('navigation',{name:'文章切换'})).toBeHidden();
  const boxes=await section.locator('.forum-entry').evaluateAll(rows=>rows.map(row=>{
    const {x,y,width,height}=row.getBoundingClientRect();return {x,y,width,height};
  }));
  expect(boxes[1].x).toBe(boxes[0].x);
  expect(boxes[1].y).toBeGreaterThanOrEqual(boxes[0].y+boxes[0].height);
  expect(boxes[2].y).toBeGreaterThanOrEqual(boxes[1].y+boxes[1].height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
  await expect(page.getByRole('button',{name:'写书评',exact:true})).toBeVisible();
  await expect(section.getByRole('link',{name:'发起讨论'})).toBeVisible();
  await section.screenshot({path:info.outputPath(`verified-desktop-${width}.png`)});
});

test('dark mode keeps both section headings readable',async ({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({colorScheme:'dark'});
  await mockArticles(page,2);
  await page.goto(detail);
  await expect(page.locator('#articles-section .forum-entry')).toHaveCount(2);
  await expect(page.locator('html')).toHaveClass(/dark/);
  const colors=await page.locator('#articles-heading').evaluate(el=>({heading:getComputedStyle(el).color,expected:getComputedStyle(document.querySelector('.book-review-content')!).color}));
  expect(colors.heading).toBe(colors.expected);
  await page.locator('#articles-section').screenshot({path:info.outputPath('verified-articles-dark.png')});
});
