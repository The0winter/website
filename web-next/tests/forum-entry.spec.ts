import {test,expect} from './fixtures/without-analytics';
import type {Page,Route} from '@playwright/test';
const base='http://127.0.0.1:3000';
test.use({reducedMotion:'no-preference',colorScheme:'light'});
const gate=()=>{let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});return {wait,release};};
async function entry(page:Page) {
  for(let pageIndex=1;pageIndex<=5;pageIndex++){
    const response=await page.request.get(`${base}/api/forum/posts?view=answers&page=${pageIndex}`);
    const row=(await response.json()).find((row:{topReply?:{source?:unknown}})=>row.topReply?.source);
    if(row)return row;
  }
  throw new Error('Missing licensed fixture');
}
async function probe(page:Page) {
  await page.addInitScript(()=>{
    const stats={motions:[] as {duration:number;height:number;frames:unknown}[],proseClones:0,oldEntryAnimations:0};
    Object.assign(window,{forumEntryStats:stats});
    const animate=Element.prototype.animate,clone=Node.prototype.cloneNode;
    Element.prototype.animate=function(frames,options){
      if(this.classList.contains('forum-navigation-panel'))stats.motions.push({duration:Number(typeof options==='object'?options.duration:options),height:this.getBoundingClientRect().height,frames});
      if(this.hasAttribute('data-forum-entering'))stats.oldEntryAnimations++;
      return animate.call(this,frames,options);
    };
    Node.prototype.cloneNode=function(deep){if(this instanceof Element&&this.closest('.qa-reader,.forum-prose'))stats.proseClones++;return clone.call(this,deep);};
  });
  await page.route('**/api/forum/posts/*/views',r=>r.fulfill({json:{counted:false}}));
}
async function stats(page:Page){return page.evaluate(()=>(window as unknown as {forumEntryStats:{motions:{duration:number;height:number;frames:Record<string,string>[]}[];proseClones:number;oldEntryAnimations:number}}).forumEntryStats);}

for(const width of [320,390,1440])for(const kind of ['answer','article'])test(`${width}px ${kind}: click slides the skeleton before route/data finish; text appears without a second animation`,async({page},info)=>{
  await page.setViewportSize({width,height:844});await probe(page);
  const row=await entry(page),rsc=gate(),data=gate();
  const href=kind==='answer'?`/forum/${row.entryId}?fromQuestion=${row.id}`:`/forum/${row.id}`;
  const documentId=kind==='answer'?row.entryId:row.id;
  const content='<p>'+('这是用于验证正文加载时机的长文。'.repeat(1000))+'</p>';
  await page.route('**/api/forum/posts?*',r=>r.fulfill({json:[kind==='answer'?row:{...row,type:'article',topReply:null,entryId:undefined,content}]}));
  await page.route(url=>url.pathname===href.split('?')[0]&&url.searchParams.has('_rsc'),async route=>{await rsc.wait;await route.continue();});
  let requests=0;
  await page.route(`**/api/forum/posts/${row.id}`,async route=>{requests++;await data.wait;await route.fulfill({json:{...row,type:kind==='answer'?'question':'article',content}});});
  await page.route(`**/api/forum/posts/${row.id}/replies?*`,async route=>{await data.wait;await route.fulfill({json:kind==='answer'?[{...row.topReply,content,time:'2026-10-01T00:00:00Z'}]:[]});});
  try {
    await page.goto(base+'/forum');await expect(page.locator('main .forum-entry')).toHaveCount(1);
    expect((await stats(page)).motions).toHaveLength(0);
    await page.locator('main .forum-entry-title').click();
    const panel=page.locator('.forum-navigation-panel');
    await expect(panel).toBeVisible();await expect(page).toHaveURL(base+href);
    await expect(panel.locator('.forum-loading-line')).toHaveCount(20);
    expect((await stats(page)).motions).toHaveLength(1);
    await expect.poll(()=>panel.evaluate(el=>getComputedStyle(el).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
    expect(requests).toBe(0);
    await page.screenshot({path:info.outputPath(`verified-${kind}-skeleton-${width}.png`)});
    rsc.release();await expect.poll(()=>requests).toBeGreaterThan(0);
    await expect(panel).toBeVisible();await expect(page.locator(`main [data-forum-document="${documentId}"]`)).toHaveCount(0);
    data.release();await expect(panel).toHaveCount(0);
    const prose=page.locator('main .forum-prose').first();await expect(prose).toContainText('这是用于验证正文加载时机的长文');
    await expect(prose).toHaveCSS('animation-name','none');await expect(page.locator('.forum-navigation-source')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
    const result=await stats(page);expect(result.motions).toHaveLength(1);expect(result.motions[0].duration).toBe(400);expect(result.motions[0].height).toBe(844);
    expect(result.motions[0].frames.every(frame=>Object.keys(frame).every(key=>key==='transform'))).toBe(true);
    expect(result.proseClones).toBe(0);expect(result.oldEntryAnimations).toBe(0);
    await info.attach('verified-entry-cost',{body:JSON.stringify(result),contentType:'application/json'});
    await page.screenshot({path:info.outputPath(`verified-${kind}-text-${width}.png`)});
  } finally {rsc.release();data.release();}
});

test('featured to forum keeps its existing section motion and adds no content entrance',async({page})=>{
  await page.setViewportSize({width:390,height:844});await probe(page);const row=await entry(page),feed=gate();
  await page.route('**/api/forum/posts?*',async r=>{await feed.wait;await r.fulfill({json:[row]});});
  try{
    await page.goto(base);await page.locator('.mh-bottom:visible [data-section=forum]').click();
    await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition',/.+/);
    feed.release();await expect(page.locator('main .forum-entry')).toHaveCount(1);
    await expect(page.locator('html')).not.toHaveAttribute('data-mobile-section-transition',/.+/);
    expect((await stats(page)).motions).toHaveLength(0);expect((await stats(page)).oldEntryAnimations).toBe(0);
    await expect(page.locator('main .forum-mobile-feed')).toHaveCSS('animation-name','none');
    await expect(page.locator('.forum-navigation-panel')).toHaveCount(0);
  }finally{feed.release();}
});

for(const action of ['back','escape'])test(`cancel a cold entry with ${action}, then Forward loads the actual answer`,async({page})=>{
  await page.setViewportSize({width:390,height:844});const row=await entry(page),held=gate();await probe(page);
  const href=`/forum/${row.entryId}?fromQuestion=${row.id}`;
  await page.route('**/api/forum/posts?*',r=>r.fulfill({json:[row]}));
  await page.route(url=>url.pathname===href.split('?')[0]&&url.searchParams.has('_rsc'),async r=>{await held.wait;await r.continue();});
  try{
    await page.goto(base+'/forum');await page.locator('main .forum-entry-title').click();await expect(page.locator('.forum-navigation-panel')).toBeVisible();
    if(action==='back')await page.goBack();else await page.keyboard.press('Escape');
    await expect(page).toHaveURL(base+'/forum');await expect(page.locator('.forum-navigation-panel')).toHaveCount(0);
    held.release();await expect(page.locator('main .forum-entry')).toHaveCount(1);
    await page.goForward();await expect(page).toHaveURL(base+href);await expect(page.locator('.qa-answer')).toHaveCount(5);
    await expect(page.locator('main .forum-page')).toHaveCount(0);
  }finally{held.release();}
});

test('fast cached entry still slides only the skeleton, including comment links and reduced motion',async({page})=>{
  await page.setViewportSize({width:390,height:844});await probe(page);const row=await entry(page);
  await page.route('**/api/forum/posts?*',r=>r.fulfill({json:[row]}));
  await page.goto(base+'/forum');
  for(let visit=0;visit<2;visit++){
    await page.locator('main .forum-entry-title').click();await expect(page.locator('.qa-answer')).toHaveCount(5);await expect(page.locator('.forum-navigation-panel')).toHaveCount(0);
    expect((await stats(page)).motions).toHaveLength(visit+1);
    await page.getByRole('link',{name:'返回问答首页'}).click();await expect(page.locator('main .forum-entry')).toHaveCount(1);
  }
  await page.locator('main .forum-entry-meta a').first().click();
  await expect(page.getByRole('dialog',{name:'回答评论'})).toBeVisible();await expect(page.locator('.forum-navigation-panel')).toHaveCount(0);
  expect((await stats(page)).motions).toHaveLength(3);
  await page.getByRole('dialog').getByRole('button',{name:'关闭弹窗'}).click();
  await page.getByRole('link',{name:'返回问答首页'}).click();await expect(page.locator('main .forum-entry')).toHaveCount(1);
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('main .forum-entry-title').click();
  await expect(page.locator('.qa-answer')).toHaveCount(5);await expect(page.locator('.forum-navigation-panel')).toHaveCount(0);expect((await stats(page)).motions).toHaveLength(3);
});

test('data errors reveal retry controls instead of leaving the loading cover stuck',async({page})=>{
  await page.setViewportSize({width:390,height:844});const row=await entry(page);
  await page.route('**/api/forum/posts?*',r=>r.fulfill({json:[row]}));
  let fail=true;
  await page.route(`**/api/forum/posts/${row.id}`,async(route:Route)=>{if(fail)await route.fulfill({status:503,json:{error:'临时无法读取'}});else await route.continue();});
  await page.goto(base+'/forum');await page.locator('main .forum-entry-title').click();
  await expect(page.locator('.qa-loading[role=alert]')).toBeVisible();await expect(page.locator('.forum-navigation-panel')).toHaveCount(0);
  fail=false;await page.getByRole('button',{name:'重新加载'}).click();await expect(page.locator('.qa-answer')).toHaveCount(5);
});
