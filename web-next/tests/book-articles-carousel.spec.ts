import {test, expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';
import type {ForumPost} from '../lib/api';

const base = process.env.DETAIL_BASE || 'http://127.0.0.1:3000';
const book = process.env.DETAIL_BOOK || '000000000000000000000101';
const detail = `${base}/book/${book}`;
const entry = '.book-article-slide:not([data-clone]) .forum-entry';
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
    const slides = [...track.querySelectorAll('.book-article-slide:not([data-clone])')];
    return [...track.children].flatMap((slide,index) => {
      const box = slide.getBoundingClientRect();
      const logicalIndex = slide.hasAttribute('data-clone') ? (index === 0 ? slides.length - 1 : 0) : slides.indexOf(slide);
      return Math.min(box.right, rect.right) - Math.max(box.left, rect.left) > 1 ? [logicalIndex] : [];
    });
  });
}

// Send native Chromium touch input: exercise browser scrolling and snapping,
// rather than dispatching synthetic DOM handlers or assigning scrollLeft.
async function swipe(page:Page, direction:'left'|'right'|'down') {
  const track = page.locator('.book-article-track');
  await track.evaluate(element => element.scrollIntoView({block:'center'}));
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
  await expect(articles.locator(entry)).toHaveCount(3);
  await expect(page.getByRole('tablist',{name:'书友交流'})).toHaveCount(0);
  expect(await reviews.locator('#articles-section').count()).toBe(0);
  expect((await articles.boundingBox())!.y).toBeGreaterThan((await reviews.boundingBox())!.y+(await reviews.boundingBox())!.height);
  await expect.poll(()=>activeSlide(page)).toEqual([0]);
  const controls=articles.getByRole('navigation',{name:'文章切换'});
  await expect(controls.getByRole('button')).toHaveCount(3);
  await expect(controls.getByRole('button',{name:'第 1 篇文章'})).toHaveAttribute('aria-current','true');
  await expect(articles).not.toContainText('左右滑动切换');
  await swipe(page,'left');
  await expect(counter).toHaveText('2 / 3');
  await expect.poll(()=>activeSlide(page)).toEqual([1]);
  await swipe(page,'left');
  await expect(counter).toHaveText('3 / 3');
  await expect.poll(()=>activeSlide(page)).toEqual([2]);
  await swipe(page,'left');
  await expect.poll(()=>activeSlide(page)).toEqual([0]);
  await expect(counter).toHaveText('1 / 3');
  await swipe(page,'right');
  await expect.poll(()=>activeSlide(page)).toEqual([2]);
  await swipe(page,'right');
  await expect(counter).toHaveText('2 / 3');
  await expect(controls.getByRole('button',{name:'第 2 篇文章'})).toHaveAttribute('aria-current','true');
  await expect.poll(()=>activeSlide(page)).toEqual([1]);
  const layout=await articles.evaluate(section=>{
    const row=section.querySelector('.book-article-slide:not([data-clone]) .forum-entry')!;
    const excerpt=row.querySelector('.forum-entry-excerpt p')!;
    return {background:getComputedStyle(section).backgroundColor,neighbor:getComputedStyle(document.querySelector('#reviews-section')!).backgroundColor,
      list:getComputedStyle(row.parentElement!).backgroundColor,lines:getComputedStyle(excerpt).webkitLineClamp,
      labels:[...row.querySelectorAll('.forum-meta-label,.forum-read-link')].map(el=>getComputedStyle(el).display)};
  });
  expect(layout.background).toBe(layout.neighbor);
  expect(layout.list).toBe('rgba(0, 0, 0, 0)');
  expect(layout.lines).toBe('2');
  expect(layout.labels.every(display=>display==='none')).toBe(true);
  const bounds=await articles.evaluate(section=>{
    const row=section.querySelectorAll('.book-article-slide:not([data-clone]) .forum-entry')[1];
    const selectors=['.forum-entry-title','.forum-entry-author','.forum-entry-excerpt','.forum-entry-meta'];
    const heading=document.querySelector('#reviews-heading')!.getBoundingClientRect();
    return {left:heading.left,right:section.getBoundingClientRect().right-parseFloat(getComputedStyle(section).paddingRight),
      contents:selectors.map(selector=>{const r=row.querySelector(selector)!.getBoundingClientRect();return {left:r.left,right:r.right};})};
  });
  for (const boundsOfContent of bounds.contents) {
    expect(boundsOfContent.left).toBeCloseTo(bounds.left,0);
    expect(boundsOfContent.right).toBeCloseTo(bounds.right,0);
  }
  await expect(articles.locator('#articles-heading')).toHaveCSS('font-size','19px');
  await expect(reviews.locator('#reviews-heading')).toHaveCSS('font-size','19px');
  await expect(articles.locator(entry).nth(1).locator('.forum-entry-title h2')).toHaveCSS('font-size','19px');
  await expect(articles.locator(entry).nth(1).locator('.forum-entry-author')).toHaveCSS('font-size','16px');
  await expect(articles.locator(entry).nth(1).locator('.forum-entry-excerpt')).toHaveCSS('font-size','17px');
  const dotBoxes=await controls.getByRole('button').evaluateAll(buttons=>buttons.map(button=>button.getBoundingClientRect().x));
  expect(dotBoxes[1]-dotBoxes[0]).toBe(24);
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

for (const count of [0,1,2,4,5]) test(`mobile boundary: ${count} articles have ${count} dots`, async ({page},info) => {
  await page.setViewportSize({width:390,height:844});
  await mockArticles(page,count);
  await page.goto(detail);
  const section=page.locator('#articles-section');
  await expect(section.locator('.forum-entry-list').first()).toHaveAttribute('aria-busy','false');
  await expect(section.locator(entry)).toHaveCount(count);
  await expect(section.getByRole('navigation',{name:'文章切换'}).getByRole('button')).toHaveCount(count);
  if (!count) await expect(section).toContainText('还没有相关文章');
  else if (count===1) {
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
  await page.getByRole('button',{name:'第 2 篇文章'}).click();
  await expect.poll(()=>activeSlide(page)).toEqual([1]);
  const track=page.locator('.book-article-track');
  await track.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(()=>activeSlide(page)).toEqual([2]);
  await page.setViewportSize({width:430,height:844});
  await expect.poll(()=>activeSlide(page)).toEqual([2]);
  await page.setViewportSize({width:1440,height:900});
  await expect(page.getByRole('navigation',{name:'文章切换'})).toBeHidden();
  await page.setViewportSize({width:430,height:844});
  await expect.poll(()=>activeSlide(page)).toEqual([2]);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('button',{name:'第 2 篇文章'}).click();
  await expect.poll(()=>activeSlide(page)).toEqual([1]);
  await track.scrollIntoViewIfNeeded();
  const before=await page.evaluate(()=>scrollY);
  await swipe(page,'down');
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeLessThan(before-40);
  await expect.poll(()=>activeSlide(page)).toEqual([1]);
});

test('loading, failure and retry preserve reviews; only six articles and six stable dots are shown', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  let fail=true;
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/books/*/discussions?*',async route=>{
    await gate;
    if (fail) return route.fulfill({status:400,json:{error:'fixture'}});
    return route.fulfill({json:{items:posts(20),total:21}});
  });
  await page.goto(detail);
  const section=page.locator('#articles-section');
  await expect(section.getByRole('status')).toBeVisible();
  await expect(page.locator('#reviews-section .book-review')).toHaveCount(1);
  release();
  await expect(section.getByRole('alert')).toContainText('讨论加载失败');
  fail=false;
  await section.getByRole('button',{name:'重试',exact:true}).click();
  await expect(section.locator(entry)).toHaveCount(6);
  const controls=section.getByRole('navigation',{name:'文章切换'});
  await expect(controls.getByRole('button')).toHaveCount(6);
  await section.getByRole('button',{name:'第 2 篇文章'}).click();
  await expect.poll(()=>activeSlide(page)).toEqual([1]);
  await section.getByRole('button',{name:'第 3 篇文章'}).click();
  await expect.poll(()=>activeSlide(page)).toEqual([2]);
  await expect(controls.getByRole('button',{name:'第 4 篇文章'})).toBeVisible();
  await expect(controls.getByRole('button')).toHaveCount(6);
  await page.emulateMedia({reducedMotion:'reduce'});
  await section.locator('.book-article-track').focus();
  for (let index=3; index<6; index++) {
    await page.keyboard.press('ArrowRight');
    await expect.poll(()=>activeSlide(page)).toEqual([index]);
  }
  await page.keyboard.press('ArrowRight');
  await expect.poll(()=>activeSlide(page)).toEqual([0]);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(()=>activeSlide(page)).toEqual([5]);
  await expect(controls.getByRole('button',{name:'第 6 篇文章'})).toHaveAttribute('aria-current','true');
  await section.getByRole('button',{name:'第 1 篇文章'}).click();
  await expect.poll(()=>activeSlide(page)).toEqual([0]);
  await expect(section.getByRole('navigation',{name:'文章分页'})).toHaveCount(0);
  await expect(section).not.toContainText('第 7 篇');
});

for (const width of [768,1440]) test(`desktop ${width}: articles stay in a vertical list with independent reviews`,async ({page},info)=>{
  await page.setViewportSize({width,height:900});
  await mockArticles(page,20);
  await page.goto(detail);
  const section=page.locator('#articles-section');
  await expect(section.locator(entry)).toHaveCount(6);
  await expect(section.getByRole('navigation',{name:'文章切换'})).toBeHidden();
  const boxes=await section.locator(entry).evaluateAll(rows=>rows.map(row=>{
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

test('dark mode keeps both sections on the same surface with readable headings',async ({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({colorScheme:'dark'});
  await mockArticles(page,2);
  await page.goto(detail);
  await expect(page.locator('#articles-section').locator(entry)).toHaveCount(2);
  await expect(page.locator('html')).toHaveClass(/dark/);
  const colors=await page.locator('#articles-heading').evaluate(el=>({heading:getComputedStyle(el).color,expected:getComputedStyle(document.querySelector('.book-review-content')!).color}));
  expect(colors.heading).toBe(colors.expected);
  const surfaces=await page.locator('#articles-section').evaluate(el=>({article:getComputedStyle(el).backgroundColor,review:getComputedStyle(document.querySelector('#reviews-section')!).backgroundColor,list:getComputedStyle(el.querySelector('.forum-entry-list')!).backgroundColor}));
  expect(surfaces.article).toBe(surfaces.review);
  expect(surfaces.list).toBe('rgba(0, 0, 0, 0)');
  await expect(page.getByRole('navigation',{name:'文章切换'}).getByRole('button')).toHaveCount(2);
  await page.locator('#articles-section').screenshot({path:info.outputPath('verified-articles-dark.png')});
});
