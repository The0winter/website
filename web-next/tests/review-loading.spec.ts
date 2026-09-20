import {test,expect,type Page} from '@playwright/test';

const base=process.env.REVIEW_BASE || 'http://127.0.0.1:3000';
const book=process.env.REVIEW_BOOK || '000000000000000000000101';
const reader={id:'000000000000000000000011',username:'山间读者',role:'reader'};
const review={_id:'000000000000000000000201',rating:4,content:'应该尽早显示的公开评论',user:{_id:'other',username:'读者'},createdAt:'2026-09-20T12:00:00Z'};
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
async function setup(page:Page){
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/session')return route.fulfill({json:{user:null,profile:null}});
    if(path.endsWith('/review-reactions'))return route.fulfill({json:[]});
    if(path.endsWith('/check'))return route.fulfill({json:{isBookmarked:false}});
    if(!['GET','HEAD'].includes(route.request().method()))return route.fulfill({json:{ok:true}});
    return route.continue();
  });
}

test('comments show before sign-in and personal review, without duplicate list reads',async({page},info)=>{
  await setup(page);await page.setViewportSize({width:390,height:844});
  const auth=gate(),list=gate(),personal=gate();let reads=0,personalReads=0,failPersonal=true;
  await page.route('**/api/auth/session',async route=>{await auth.promise;await route.fulfill({json:{user:reader,profile:reader}});});
  await page.route(`**/api/books/${book}/reviews?*`,async route=>{reads++;await list.promise;await route.fulfill({json:[review],headers:{'X-Total-Count':'1','X-Review-Distribution':'{"4":1}'}});});
  await page.route(`**/api/books/${book}/reviews/mine`,async route=>{
    personalReads++;await personal.promise;
    await route.fulfill(failPersonal?{status:503,json:{error:'unavailable'}}:{json:{...review,_id:'mine',content:'我已保存的书评',user:{_id:reader.id,username:reader.username}}});
  });
  try{
    await page.goto(`${base}/book/${book}`);
    await expect(page.getByRole('status').filter({hasText:'正在加载评论'})).toBeVisible();
    await expect(page.getByText('还没有人评价，快来抢沙发！')).toHaveCount(0);
    await page.screenshot({path:info.outputPath('verified-review-loading.png')});
    list.release();await expect(page.getByText(review.content,{exact:true})).toBeVisible();
    const initialReads=reads;
    auth.release();await expect.poll(()=>personalReads).toBeGreaterThan(0);
    expect(reads).toBe(initialReads);
    await expect(page.getByText(review.content,{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'写书评',exact:true})).toBeDisabled();
    personal.release();await expect(page.getByRole('alert').filter({hasText:'个人书评读取失败'})).toBeVisible();
    await expect(page.getByText(review.content,{exact:true})).toBeVisible();
    failPersonal=false;await page.getByRole('button',{name:'重试',exact:true}).click();
    await expect(page.getByText('我已保存的书评',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'写书评',exact:true}).click();
    await expect(page.getByPlaceholder('写下你的短评...')).toHaveValue('我已保存的书评');
  }finally{auth.release();list.release();personal.release();}
});

for(const width of [320,1440])test(`empty comments appear only after a successful response at ${width}px`,async({page})=>{
  await setup(page);await page.setViewportSize({width,height:900});
  const response=gate();let fail=true;
  await page.route(`**/api/books/${book}/reviews?*`,async route=>{
    await response.promise;
    await route.fulfill(fail?{status:503,json:{error:'unavailable'}}:{json:[],headers:{'X-Total-Count':'0','X-Review-Distribution':'{}'}});
  });
  try{
    await page.goto(`${base}/book/${book}`);
    const panel=page.locator('#reviews-panel');
    await expect(panel).toHaveAttribute('aria-busy','true');
    await expect(page.getByText('还没有人评价，快来抢沙发！')).toHaveCount(0);
    response.release();await expect(panel.getByRole('alert')).toContainText('评论加载失败');
    await expect(page.getByText('还没有人评价，快来抢沙发！')).toHaveCount(0);
    fail=false;await panel.getByRole('button',{name:'重试',exact:true}).click();
    await expect(panel).toHaveAttribute('aria-busy','false');
    await expect(page.getByText('还没有人评价，快来抢沙发！')).toBeVisible();
  }finally{response.release();}
});

test('changing comment pages shows progress without displaying stale comments',async({page})=>{
  await setup(page);await page.setViewportSize({width:390,height:844});
  const next=gate();
  await page.route(`**/api/books/${book}/reviews?*`,async route=>{
    const second=new URL(route.request().url()).searchParams.get('page')==='2';
    if(second)await next.promise;
    await route.fulfill({json:[{...review,content:second?'第二页评论':'第一页评论'}],headers:{'X-Total-Count':'21','X-Review-Distribution':'{"4":21}'}});
  });
  try{
    await page.goto(`${base}/book/${book}`);await expect(page.getByText('第一页评论',{exact:true})).toBeVisible();
    await page.getByRole('navigation',{name:'评价分页'}).getByRole('button',{name:'下一页'}).click();
    await expect(page.getByRole('status').filter({hasText:'正在加载评论'})).toBeVisible();
    await expect(page.getByText('第一页评论',{exact:true})).toHaveCount(0);
    next.release();await expect(page.getByText('第二页评论',{exact:true})).toBeVisible();
  }finally{next.release();}
});
