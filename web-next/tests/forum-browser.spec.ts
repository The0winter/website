import {test,expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';

const base=process.env.FORUM_BASE || 'http://127.0.0.1:3000';
const rows=Array.from({length:20},(_,index)=>({id:`question-${index}`,title:`讨论 ${index}：阅读时如何保持专注？`,author:'书友',votes:10,comments:2,tags:[],isHot:false,type:'question',topReply:{id:`answer-${index}`,content:'用于验证论坛列表、触控和跨浏览器导航的回答摘要。'.repeat(4),votes:8,comments:2,author:{id:'reader',name:'书友'}}}));
async function idle(page:Page){
  await expect(page.locator('.mobile-section-snapshot,.mobile-section-header,.mobile-section-backdrop')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-mobile-section-transition',/.+/);
}

test('a selected answer opens directly and from the question page',async({page})=>{
  test.skip(Boolean(process.env.FORUM_BASE),'Synthetic forum records only exist in the local fixture');
  const question='000000000000000000000501',answer='000000000000000000000601';
  const response=await page.goto(`${base}/forum/${answer}?fromQuestion=${question}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByText('这是一篇用于跨浏览器检查的完整回答。',{exact:true})).toBeVisible();
  await page.goto(`${base}/forum/question/${question}`);
  await page.locator(`a[href="/forum/${answer}?fromQuestion=${question}"]`).first().tap();
  await expect(page.getByText('这是一篇用于跨浏览器检查的完整回答。',{exact:true})).toBeVisible();
});
test.beforeEach(async({page})=>{
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:null,profile:null}}));
  await page.route('**/api/traffic/observe',route=>route.fulfill({status:204}));
  await page.route('**/api/forum/posts?*',route=>route.fulfill({json:rows}));
});

test('initial forum loads one feed and renders one copy of its list',async({page})=>{
  const requests:string[]=[];
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/forum/posts')requests.push(url.searchParams.get('tab')!);});
  await page.goto(base+'/forum');
  await expect(page.locator('.forum-page:visible article').first()).toBeVisible();
  expect(requests).toEqual(['recommend']);
  await expect(page.locator('.forum-page:visible article')).toHaveCount(20);
  await page.getByRole('button',{name:'热榜',exact:true}).tap();
  await expect(page.getByRole('button',{name:'热榜',exact:true})).toHaveAttribute('aria-current','page');
  await expect.poll(()=>requests).toEqual(['recommend','hot']);
  await page.getByRole('button',{name:'推荐',exact:true}).tap();
  expect(requests).toEqual(['recommend','hot']);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
});

test('a failed feed can retry while slow hidden tabs never replace the current list',async({page})=>{
  let recommend=0;
  let releaseHot=()=>{};
  const hotReady=new Promise<void>(resolve=>{releaseHot=resolve;});
  await page.route('**/api/forum/posts?*',async route=>{
    const tab=new URL(route.request().url()).searchParams.get('tab');
    if(tab==='recommend' && ++recommend===1)return route.fulfill({status:503,json:{error:'temporarily unavailable'}});
    if(tab==='hot')await hotReady;
    await route.fulfill({json:rows.map(row=>({...row,title:(tab==='hot'?'热榜 ':'推荐 ')+row.title}))});
  });
  await page.goto(base+'/forum');
  const panel=page.locator('.forum-feed-panel[aria-hidden=false]');
  await expect(panel.getByText('暂时无法加载，请重试')).toBeVisible();
  await panel.getByRole('button',{name:'重新加载'}).tap();
  await expect(panel.locator('article')).toHaveCount(20);
  await page.getByRole('button',{name:'热榜',exact:true}).tap();
  await expect(panel.getByText('加载中...', {exact:true})).toBeVisible();
  await page.getByRole('button',{name:'推荐',exact:true}).tap();
  await expect(panel.locator('h2').first()).toHaveText(/^推荐 /);
  releaseHot();
  await expect(page.locator('.forum-feed-panel[aria-hidden=true] article')).toHaveCount(20);
  await expect(panel.locator('h2').first()).toHaveText(/^推荐 /);
  expect(recommend).toBe(2);
});

test('desktop and narrow mobile keep working tabs and readable lists',async({page},info)=>{
  await page.goto(base+'/forum');
  for(const width of [320,1440,390]){
    await page.setViewportSize({width,height:844});
    await page.getByRole('button',{name:'热榜',exact:true}).tap();
    await expect(page.getByRole('button',{name:'热榜',exact:true})).toHaveAttribute('aria-current','page');
    const panel=page.locator('.forum-feed-panel[aria-hidden=false]');
    await expect(panel.locator('article').first()).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({path:info.outputPath(`verified-forum-${width}.png`),animations:'disabled'});
    await page.getByRole('button',{name:'推荐',exact:true}).tap();
    await expect(panel.locator('article').first()).toBeInViewport();
  }
});

test('swiping populated lists remains responsive on a slower CPU',async({page,context,browserName})=>{
  test.skip(browserName!=='chromium','CPU throttling and native touch dispatch require Chromium CDP');
  const cdp=await context.newCDPSession(page);
  try{
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    await page.goto(base+'/forum');
    await expect(page.locator('.forum-page:visible article').first()).toBeVisible();
    for(const name of ['热榜','关注']){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:310,y:350,id:1}]});
      for(const x of [280,250,220,190,160,130])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:350,id:1}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await expect(page.getByRole('button',{name,exact:true})).toHaveAttribute('aria-current','page');
    }
    await expect(page.locator('.forum-feed-panel[aria-hidden=false] article')).toHaveCount(20);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:195,y:640,id:1}]});
    for(const y of [590,530,460,380,300])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195,y,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(100);
    await expect(page).toHaveURL(base+'/forum');
  }finally{await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await cdp.detach();}
});

for(const failure of ['absent','throws','no-finished','stalled'] as const){
  test(`forum navigation recovers from ${failure} animations`,async({page})=>{
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(failure=>{
      const original=Element.prototype.animate;
      if(failure==='absent')Object.defineProperty(Element.prototype,'animate',{value:undefined});
      else Element.prototype.animate=function(...args:Parameters<typeof original>){
        if(failure==='throws')throw Error('Animation unavailable');
        const animation=original.apply(this,args);
        if(failure==='stalled')animation.pause();
        else Object.defineProperty(animation,'finished',{value:undefined});
        return animation;
      };
    },failure);
    await page.goto(base+'/');
    await page.locator('.mobile-home .mh-bottom [data-section=forum]').tap();
    await expect(page).toHaveURL(base+'/forum');await idle(page);
    await expect(page.locator('.forum-page:visible article').first()).toBeVisible();
    await page.getByRole('button',{name:'热榜',exact:true}).tap();
    await expect(page.getByRole('button',{name:'热榜',exact:true})).toHaveAttribute('aria-current','page');
    await page.locator('.forum-page:visible .mh-bottom [data-section=home]').tap();
    await expect(page).toHaveURL(base+'/');await idle(page);
    expect(errors).toEqual([]);
  });
}
