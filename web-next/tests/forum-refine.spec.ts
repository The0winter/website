import {test,expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';
const base='http://127.0.0.1:3000';
test.use({colorScheme:'light',reducedMotion:'no-preference'});
async function entry(page:Page) {
  for(let index=1;index<=5;index++) {
    const response=await page.request.get(base+`/api/forum/posts?view=answers&page=${index}`);
    expect(response.ok()).toBeTruthy();
    const rows=await response.json();
    const row=rows.find((row:{topReply?:{source?:unknown}})=>row.topReply?.source);
    if(row)return row;
    if(!rows.length)break;
  }
  throw new Error('The licensed answer fixture is missing');
}
test.beforeEach(async({page})=>{
  await page.route('**/api/forum/posts/*/views',route=>route.fulfill({json:{counted:false}}));
});
for(const width of [320,390,1440])test(`${width}px reader controls and comments match the book detail sheet`,async({page},info)=>{
  await page.setViewportSize({width,height:844});
  const row=await entry(page);
  const comments=[{id:'010000000000000000000001',replyId:row.entryId,parentCommentId:null,content:'这段回答提供了不同的阅读角度。',votes:2,time:'2026-10-01T00:00:00Z',author:{id:'000000000000000000000001',name:'读书的人',avatar:''}},{id:'010000000000000000000002',replyId:row.entryId,parentCommentId:'010000000000000000000001',content:'同意，值得再读一遍。',votes:0,time:'2026-10-01T00:00:00Z',author:{id:'000000000000000000000002',name:'山间来信',avatar:''}}];
  await page.route(`**/api/forum/replies/${row.entryId}/comments?*`,route=>route.fulfill({json:comments}));
  await page.addInitScript(()=>localStorage.setItem('forum_reader_settings_v1',JSON.stringify({fontSize:17})));
  await page.goto(`${base}/forum/${row.entryId}?fromQuestion=${row.id}`);
  await expect(page.locator('.qa-body').first()).toHaveCSS('font-size','18px');
  await expect(page.locator('.qa-topbar')).toHaveCSS('border-bottom-width','0px');
  await expect(page.locator('.qa-nav-title')).toHaveCount(0);
  await expect(page.locator('.qa-author button')).toHaveCount(0);
  await expect(page.locator('.qa-more-button svg')).toHaveClass(/lucide-ellipsis/);
  await expect(page.getByRole('button',{name:'分享当前回答'}).locator('svg')).toHaveAttribute('data-share-arrow','curved');
  await expect(page.locator('[data-forum-entering]')).toHaveCount(0);
  await page.screenshot({path:info.outputPath(`verified-reader-${width}.png`)});
  await page.getByRole('button',{name:'打开当前回答评论'}).click();
  const sheet=page.getByRole('dialog',{name:'回答评论'});
  await expect(sheet).toHaveClass(/book-review-sheet/);
  await expect(sheet).toHaveCSS('animation-duration','0.4s');
  await expect(sheet.locator('.qa-comment')).toHaveCount(2);
  await expect.poll(async()=>Math.round((await sheet.boundingBox())!.y)).toBe(42);
  const shape=await sheet.evaluate(node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return {width:r.width,height:r.height,radius:s.borderRadius,background:s.backgroundColor};});
  await page.screenshot({path:info.outputPath(`verified-comments-${width}.png`)});
  await page.keyboard.press('Escape');await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button',{name:'打开当前回答评论'})).toBeFocused();
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
  const book='000000000000000000000101';
  await page.route(`**/api/books/${book}/reviews?*`,route=>route.fulfill({json:[{_id:'000000000000000000000002',rating:4,content:'书籍详情页的参考评论。',createdAt:'2026-10-01T00:00:00Z',user:{_id:'000000000000000000000001',username:'读书的人'}}],headers:{'X-Total-Count':'1','X-Next-Cursor':'','X-Review-Distribution':'{"4":1}'}}));
  await page.route(`**/api/books/${book}/review-reactions?*`,route=>route.fulfill({json:[]}));
  await page.goto(`${base}/book/${book}`);
  await page.getByRole('button',{name:'查看全部评论',exact:true}).click();
  const bookSheet=page.getByRole('dialog',{name:'全部评论'});
  await expect.poll(async()=>Math.round((await bookSheet.boundingBox())!.y)).toBe(42);
  expect(await bookSheet.evaluate(node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return {width:r.width,height:r.height,radius:s.borderRadius,background:s.backgroundColor};})).toEqual(shape);
  await bookSheet.getByRole('button',{name:'关闭全部评论'}).click();await expect(bookSheet).toHaveCount(0);
});
test('long-answer entry animates one bounded surface and releases it after 400ms',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});const row=await entry(page);
  await page.addInitScript(()=>{
    const animate=Element.prototype.animate,clone=Node.prototype.cloneNode;
    Object.assign(window,{forumMotion:[],forumClones:0});
    Element.prototype.animate=function(frames,options){
      if(this.hasAttribute('data-forum-entering')){
        const metric={height:this.getBoundingClientRect().height,viewport:innerHeight,frames,duration:typeof options==='object'?options.duration:options};
        (window as unknown as {forumMotion:unknown[]}).forumMotion.push(metric);
      }
      return animate.call(this,frames,options);
    };
    Node.prototype.cloneNode=function(deep){if(this instanceof Element&&this.closest('.qa-reader'))(window as unknown as {forumClones:number}).forumClones++;return clone.call(this,deep);};
  });
  const answers=Array.from({length:20},(_,i)=>({...row.topReply,id:String(i).padStart(24,'0'),content:`<p>${'长回答滚动性能验证。'.repeat(600)}</p>`,time:'2026-10-01T00:00:00Z'}));
  await page.route(`**/api/forum/posts/${row.id}/replies?*`,route=>route.fulfill({json:answers}));
  await page.goto(`${base}/forum/question/${row.id}`);
  await expect(page.locator('.qa-answer')).toHaveCount(20);
  await expect(page.locator('[data-forum-entering]')).toHaveCount(0);
  const metrics=await page.evaluate(()=>({motion:(window as unknown as {forumMotion:{height:number;viewport:number;duration:number;frames:Record<string,string>[]}[]}).forumMotion,clones:(window as unknown as {forumClones:number}).forumClones}));
  expect(metrics.motion).toHaveLength(1);expect(metrics.clones).toBe(0);
  expect(metrics.motion[0].height).toBeLessThanOrEqual(metrics.motion[0].viewport);
  expect(metrics.motion[0].duration).toBe(400);
  expect(metrics.motion[0].frames.every(frame=>Object.keys(frame).every(key=>key==='transform'))).toBe(true);
  expect(await page.locator('.qa-layout').evaluate(node=>getComputedStyle(node).maxHeight)).toBe('none');
  expect(await page.locator('.qa-layout').evaluate(node=>getComputedStyle(node).transform)).toBe('none');
  await info.attach('verified-motion-cost',{body:JSON.stringify(metrics),contentType:'application/json'});
});
