import {test,expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';
const base='http://127.0.0.1:3000';
test.use({colorScheme:'light',reducedMotion:'no-preference'});
const gate=()=>{let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});return{wait,release};};
async function entry(page:Page){for(let i=1;i<=5;i++){const rows=await(await page.request.get(base+`/api/forum/posts?view=answers&page=${i}`)).json();const row=rows.find((r:{topReply?:{source?:unknown}})=>r.topReply?.source);if(row)return row;}throw Error('Missing fixture');}
test.beforeEach(async({page})=>{await page.route('**/api/forum/posts/*/views',r=>r.fulfill({json:{counted:false}}));});

for(const width of [320,390,1440])test(`${width}px answer heading and count open question previews and return to the selected answer`,async({page},info)=>{
  await page.setViewportSize({width,height:844});const row=await entry(page),href=`${base}/forum/${row.entryId}?fromQuestion=${row.id}`;
  await page.goto(href);await expect(page.locator('.qa-answer').first()).toBeVisible();
  const write=page.locator('.qa-topbar .qa-write-button');await expect(write).toHaveCSS('background-color','rgb(22, 119, 255)');
  await expect(write.locator('.lucide-square-pen')).toHaveCount(1);await expect(page.locator('.qa-answer-count svg')).toHaveCount(1);
  await page.screenshot({path:info.outputPath(`verified-answer-button-${width}.png`)});
  for(const selector of ['.qa-question h1 a','.qa-answer-count']){
    await page.locator(selector).click();await expect(page.locator('.fq-heading h1')).toHaveText(row.title);await expect(page.locator('.forum-navigation-panel')).toHaveCount(0);
    await expect(page.locator('.fq-answer')).toHaveCount(5);await expect(page.locator('.qa-answer-stream')).toHaveCount(0);
    await expect(page.getByRole('tab',{name:'默认',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(page.locator('.fq-tabs')).toContainText('全部内容 5');await expect(page.getByRole('button',{name:'关注问题',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({path:info.outputPath(`verified-question-${width}.png`)});
    await page.getByRole('button',{name:'返回上一页'}).click();await expect(page).toHaveURL(href);await expect(page.locator('.qa-answer').first()).toBeVisible();
  }
  await page.locator('.qa-answer-count').click();await expect(page.locator('.fq-answer')).toHaveCount(5);await expect(page.locator('.forum-navigation-panel')).toHaveCount(0);
  const link=page.locator('.fq-answer-link').first(),target=await link.getAttribute('href');await link.click();
  await expect(page).toHaveURL(base+target);await expect(page.locator('.qa-answer').first()).toBeVisible();await expect(page.locator('.forum-navigation-panel')).toHaveCount(0);
});

test('opening a question slides a bounded skeleton without cloning the reader; early back and forward recover',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});const row=await entry(page),held=gate();
  await page.goto(`${base}/forum/${row.entryId}?fromQuestion=${row.id}`);await expect(page.locator('.qa-answer').first()).toBeVisible();
  const wrongPostRequests:string[]=[];page.on('request',request=>{if(new URL(request.url()).pathname===`/api/forum/posts/${row.entryId}`)wrongPostRequests.push(request.url());});
  await page.evaluate(()=>{const stats={clones:0,durations:[] as number[]};Object.assign(window,{questionMotion:stats});const clone=Node.prototype.cloneNode,animate=Element.prototype.animate;Node.prototype.cloneNode=function(deep){if(this instanceof Element&&this.closest('.qa-reader'))stats.clones++;return clone.call(this,deep);};Element.prototype.animate=function(frames,options){if(this.classList.contains('forum-navigation-panel'))stats.durations.push(Number(typeof options==='object'?options.duration:options));return animate.call(this,frames,options);};});
  await page.route(`**/api/forum/posts/${row.id}`,async r=>{await held.wait;await r.continue();});
  try{
    await page.locator('.qa-answer-count').click();await expect(page.locator('.forum-navigation-panel .forum-question-loading')).toBeVisible();
    await expect(page.locator('.forum-navigation-panel')).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
    await expect(page.locator('.fq-heading')).toHaveCount(0);await page.screenshot({path:info.outputPath('verified-question-skeleton.png')});
    held.release();await expect(page.locator('.fq-heading')).toBeVisible();await expect(page.locator('.forum-navigation-panel')).toHaveCount(0);
    const metrics=await page.evaluate(()=>(window as unknown as {questionMotion:{clones:number;durations:number[]}}).questionMotion);expect(metrics).toEqual({clones:0,durations:[400]});
    expect(wrongPostRequests).toEqual([]);
    await page.getByRole('button',{name:'返回上一页'}).click();await expect(page.locator('.qa-answer').first()).toBeVisible();
    await page.locator('.qa-answer-count').click();await page.goBack();await expect(page.locator('.forum-navigation-panel')).toHaveCount(0);await expect(page.locator('.qa-answer').first()).toBeVisible();
    await page.goForward();await expect(page.locator('.fq-heading')).toBeVisible();await expect(page.locator('.qa-answer-stream')).toHaveCount(0);
  }finally{held.release();}
});

test('latest sorting covers all pages; stale pages cannot enter a new order and failures retry in place',async({page})=>{
  const row=await entry(page),held=gate();let fail=true;
  const rows=Array.from({length:25},(_,i)=>({id:(i+1).toString(16).padStart(24,'0'),content:'独立回答摘要 '+i,votes:25-i,comments:i,time:new Date(2026,0,i+1).toISOString(),author:{id:'author-'+i,name:'作者 '+i,avatar:''}}));
  await page.route(`**/api/forum/posts/${row.id}`,r=>r.fulfill({json:{...row,comments:25,content:''}}));
  await page.route(`**/api/forum/posts/${row.id}/replies?*`,async r=>{const url=new URL(r.request().url()),latest=url.searchParams.get('sort')==='latest',page=Number(url.searchParams.get('page'));if(!latest&&page===2)await held.wait;if(latest&&page===2&&fail){fail=false;return r.fulfill({status:503,json:{error:'稍后重试'}});}const ordered=latest?[...rows].reverse():rows;await r.fulfill({json:ordered.slice((page-1)*20,page*20)});});
  try{
    await page.goto(`${base}/forum/question/${row.id}`);await expect(page.locator('.fq-answer')).toHaveCount(20);
    await page.getByRole('button',{name:'加载更多回答'}).click();await page.getByRole('tab',{name:'最新',exact:true}).click();
    await expect(page.locator('.fq-answer').first()).toHaveAttribute('data-answer-id',rows[24].id);held.release();await expect(page.locator('.fq-answer')).toHaveCount(20);
    await page.getByRole('button',{name:'加载更多回答'}).click();await expect(page.locator('.fq-more [role=alert]')).toHaveText('稍后重试');await expect(page.locator('.fq-answer')).toHaveCount(20);
    await page.getByRole('button',{name:'重试',exact:true}).click();await expect(page.locator('.fq-answer')).toHaveCount(25);
    expect(await page.locator('.fq-answer').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-answer-id')))).toEqual([...rows].reverse().map(r=>r.id));
    await page.reload();await expect(page.getByRole('tab',{name:'最新',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.locator('.fq-answer').first()).toHaveAttribute('data-answer-id',rows[24].id);
  }finally{held.release();}
});

test('question writing shares the answer draft, and invitation falls back to a copyable problem link',async({page})=>{
  await page.setViewportSize({width:390,height:844});const row=await entry(page);
  const csrf=await(await page.request.get(base+'/api/auth/csrf')).json();expect((await page.request.post(base+'/api/auth/signin',{headers:{origin:base,'x-csrf-token':csrf.csrfToken},data:{email:'reader@example.test',password:'Local-test-12345'}})).ok()).toBeTruthy();
  await page.goto(`${base}/forum/question/${row.id}`);await page.locator('.fq-actions .fq-write').click();await page.getByRole('textbox',{name:'回答内容'}).fill('从问题页继续书写的草稿');await page.getByRole('button',{name:'关闭弹窗'}).click();
  await page.goto(`${base}/forum/${row.entryId}?fromQuestion=${row.id}`);await page.locator('.qa-topbar .qa-write-button').click();await expect(page.getByRole('textbox',{name:'回答内容'})).toHaveValue('从问题页继续书写的草稿');await page.getByRole('button',{name:'关闭弹窗'}).click();
  await page.locator('.qa-answer-count').click();await expect(page.locator('.forum-navigation-panel')).toHaveCount(0);
  await page.evaluate(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('No clipboard'))}});});
  await page.locator('.fq-actions').getByRole('button',{name:'邀请回答'}).click();await expect(page.getByRole('textbox',{name:'邀请回答链接'})).toHaveValue(`${base}/forum/question/${row.id}`);
});
