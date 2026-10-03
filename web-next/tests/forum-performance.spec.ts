import {test, expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';

const base = process.env.FORUM_PERF_BASE || 'http://127.0.0.1:3000';
const gate = () => {let release!:()=>void; const wait = new Promise<void>(resolve => {release = resolve;}); return {wait, release};};
async function fixture(page:Page) {
  const rows = await (await page.request.get(base+'/api/forum/posts?view=answers')).json();
  const row = rows.find((item:{topReply?:unknown})=>item.topReply);
  expect(row).toBeTruthy();
  const reading = await (await page.request.get(`${base}/api/forum/posts/${row.id}/reading?answer=${row.topReply.id}`)).json();
  return {row, reading};
}
test.beforeEach(async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:null,profile:null}}));
  await page.route('**/api/traffic/observe',route=>route.fulfill({status:204}));
  await page.route('**/api/forum/posts/*/views',route=>route.fulfill({json:{counted:false}}));
});

test('mobile feed paints five, idles to ten, scrolls to more, retries and returns to its retained position',async({page})=>{
  const {row} = await fixture(page), second = gate();
  const rows = Array.from({length:15},(_,i)=>({...row,entryId:String(i).padStart(24,'0'),title:`预览卡片 ${i+1}：${row.title}`}));
  const requests:number[]=[]; let failThird=true;
  await page.route('**/api/forum/posts?*',async route=>{
    const url=new URL(route.request().url());
    const offset=Number(url.searchParams.get('cursor')||0),limit=Number(url.searchParams.get('limit')||20);
    requests.push(offset);expect(limit).toBe(5);
    if(offset===5)await second.wait;
    if(offset===10&&failThird){failThird=false;await route.fulfill({status:503,json:{error:'暂时不可用'}});return;}
    await route.fulfill({json:{items:rows.slice(offset,offset+limit),nextCursor:offset+limit<rows.length?String(offset+limit):null}});
  });
  try {
    await page.goto(base+'/forum');
    const cards=page.locator('main .forum-feed-panel[aria-hidden=false] .forum-entry');
    await expect(cards).toHaveCount(5);await expect(cards.first()).toBeVisible();
    await expect.poll(()=>requests).toEqual([0,5]);
    second.release();await expect(cards).toHaveCount(10);
    await page.waitForTimeout(800);expect(requests).toEqual([0,5]);
    await page.locator('.forum-feed-more').scrollIntoViewIfNeeded();
    await expect(page.locator('.forum-feed-more [role=alert]')).toBeVisible();await expect(cards).toHaveCount(10);
    await page.locator('.forum-feed-more').getByRole('button',{name:'重试'}).click();await expect(cards).toHaveCount(15);
    await cards.nth(6).scrollIntoViewIfNeeded();
    // Record the position at the actual tap, after Playwright has brought the
    // title clear of the sticky toolbar (which can scroll a tall card again).
    await page.evaluate(()=>document.addEventListener('pointerdown',()=>Object.assign(window,{forumScrollOnTap:scrollY}),{once:true,capture:true}));
    await cards.nth(6).locator('.forum-entry-title').click();
    const before=await page.evaluate(()=>(window as unknown as {forumScrollOnTap:number}).forumScrollOnTap);
    await expect(page.locator('main .qa-answer').first()).toBeVisible();
    await page.goBack();await expect(cards).toHaveCount(15);
    await expect.poll(async()=>Math.abs(await page.evaluate(()=>scrollY)-before)).toBeLessThan(8);
    expect(await cards.evaluateAll(nodes=>new Set(nodes.map(n=>n.getAttribute('data-entry-id'))).size)).toBe(15);
    expect(requests.filter(offset=>offset===0)).toHaveLength(1);
  } finally {second.release();}
});

test('expired recommendations renew once, retain existing cards, and recover from a renewal failure',async({page})=>{
  const {row}=await fixture(page);
  const rows=Array.from({length:10},(_,i)=>({...row,entryId:String(i).padStart(24,'0'),title:`自动续接 ${i+1}`}));
  const requests:(string|null)[]=[];let newSessions=0;
  await page.route('**/api/forum/posts?*',async route=>{
    const cursor=new URL(route.request().url()).searchParams.get('cursor');requests.push(cursor);
    if(cursor==='expired')return route.fulfill({status:410,json:{error:'推荐已更新，请重新加载'}});
    newSessions++;
    if(newSessions===2)return route.fulfill({status:503,json:{error:'暂时不可用'}});
    await route.fulfill({json:newSessions===1?{items:rows.slice(0,5),nextCursor:'expired'}:{items:[rows[0],...rows.slice(5)],nextCursor:null}});
  });
  await page.goto(base+'/forum');
  const cards=page.locator('.forum-feed-panel[aria-hidden=false] .forum-entry');
  await expect(cards).toHaveCount(5);
  await expect(page.locator('.forum-feed-more [role=alert]')).toHaveText('更多内容加载失败，请重试');
  expect(requests).toEqual([null,'expired',null]);
  await page.waitForTimeout(300);expect(requests).toHaveLength(3);
  await page.locator('.forum-feed-more').getByRole('button',{name:'重试'}).click();
  await expect(cards).toHaveCount(10);
  expect(await cards.locator('h2').allTextContents()).toEqual(rows.map(row=>row.title));
  expect(requests).toEqual([null,'expired',null,'expired',null]);
  await expect(page.getByText('暂时没有更多内容，稍后再来看看')).toBeVisible();
  await expect(page.getByText(/换一批/)).toHaveCount(0);
});

test('selected body is readable before other answers, and repeat entry reuses its request',async({page})=>{
  const {row,reading}=await fixture(page), more=gate();let reads=0,otherReads=0;
  reading.post.comments=6;
  const long='<p>当前回答应立即可读。</p>'.repeat(150);
  reading.answer.content=long;
  await page.route('**/api/forum/posts?*',route=>route.fulfill({json:{items:[row],nextCursor:null}}));
  await page.route(`**/api/forum/posts/${row.id}/reading?*`,route=>{reads++;return route.fulfill({json:reading});});
  await page.route(`**/api/forum/posts/${row.id}/replies?page=*`,async route=>{
    otherReads++;await more.wait;
    await route.fulfill({json:[reading.answer,{...reading.answer,id:'00000000000000000000abcd',content:'<p>另一篇回答</p>'}]});
  });
  try {
    await page.goto(base+'/forum');await page.locator('main .forum-entry-title').click();
    await expect(page.locator('main .qa-body p')).toHaveCount(150);
    await expect(page.locator('.forum-navigation-panel')).toHaveCount(0);
    expect(otherReads).toBe(0);expect(reads).toBe(1);
    await page.locator('.qa-stream-end').scrollIntoViewIfNeeded();
    await expect.poll(()=>otherReads).toBe(1);
    await expect(page.locator('.qa-answer')).toHaveCount(1);
    await expect(page.locator('.qa-stream-end')).toContainText('正在加载更多回答');
    more.release();await expect(page.locator('.qa-answer')).toHaveCount(2);
    await page.getByRole('link',{name:'返回问答首页'}).click();
    await page.locator('main .forum-entry-title').click();await expect(page.locator('.qa-answer')).toHaveCount(2);
    expect(reads).toBe(1);expect(otherReads).toBe(1);
  } finally {more.release();}
});

test('article paints without fetching its comments until the dialog opens',async({page})=>{
  const {row,reading}=await fixture(page);let comments=0;
  const article={...reading.post,type:'article',content:'<p>独立文章无需等待评论。</p>',comments:2};
  await page.route(`**/api/forum/posts/${row.id}/reading`,route=>route.fulfill({json:{post:article,answer:null}}));
  await page.route(`**/api/forum/posts/${row.id}/replies?*`,route=>{comments++;return route.fulfill({json:[]});});
  await page.goto(`${base}/forum/${row.id}`);
  await expect(page.locator('main .forum-prose')).toContainText('独立文章无需等待评论');
  expect(comments).toBe(0);
  await page.getByRole('button',{name:'打开评论',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'文章评论'})).toBeVisible();
  await expect.poll(()=>comments).toBe(1);
});

test('desktop first batch uses twenty and changing tabs never replaces the active feed',async({page})=>{
  await page.setViewportSize({width:1440,height:900});const {row}=await fixture(page),hot=gate();
  const requests:string[]=[];
  await page.route('**/api/forum/posts?*',async route=>{
    const url=new URL(route.request().url()),tab=url.searchParams.get('tab')!;
    expect(url.searchParams.get('limit')).toBe('20');requests.push(tab);
    if(tab==='hot')await hot.wait;
    await route.fulfill({json:{items:Array.from({length:20},(_,i)=>({...row,entryId:String(i),title:`${tab} ${i}`})),nextCursor:null}});
  });
  try{
    await page.goto(base+'/forum');const panel=page.locator('.forum-feed-panel[aria-hidden=false]');
    await expect(panel.locator('article')).toHaveCount(20);
    await page.getByRole('button',{name:'热榜',exact:true}).click();await expect.poll(()=>requests.length).toBe(2);
    await page.getByRole('button',{name:'推荐',exact:true}).click();hot.release();
    await expect(panel.locator('h2').first()).toHaveText('recommend 0');expect(requests).toEqual(['recommend','hot']);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(1440);
  }finally{hot.release();}
});
