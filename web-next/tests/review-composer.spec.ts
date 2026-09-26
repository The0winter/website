import {test,expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';

const base=process.env.REVIEW_BASE||'http://127.0.0.1:3157',book=process.env.REVIEW_BOOK||'000000000000000000000101';
const reader={id:'000000000000000000000011',username:'山间读者',role:'reader'};
const row=(id:string,content:string)=>({_id:id,rating:4,content,user:{_id:'other',username:'书友'},createdAt:'2026-09-26T10:00:00Z'});

async function mocks(page:Page,rows:ReturnType<typeof row>[]){
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/session')return route.fulfill({json:{user:reader,profile:reader}});
    if(path==='/api/auth/csrf')return route.fulfill({json:{csrfToken:'fixture'}});
    if(path.endsWith('/review-reactions'))return route.fulfill({json:rows.map(row=>({id:row._id,likes:0,dislikes:0,reaction:null}))});
    if(path.endsWith('/check'))return route.fulfill({json:{isBookmarked:false}});
    if(!['GET','HEAD'].includes(route.request().method()))return route.fulfill({json:{ok:true}});
    return route.continue();
  });
  await page.route(`**/api/books/${book}/reviews?*`,route=>{
    const url=new URL(route.request().url()),offset=Number(url.searchParams.get('cursor')||0),limit=Number(url.searchParams.get('limit'));
    return route.fulfill({json:rows.slice(offset,offset+limit),headers:{'X-Total-Count':String(rows.length),'X-Next-Cursor':offset+limit<rows.length?String(offset+limit):'','X-Review-Distribution':'{"4":3}'}});
  });
}

for(const width of [320,390,1440])test(`bottom composer preserves drafts and existing ratings at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  const rows=[row('first','一条不同的评论'),row('mine','已经保存的短评')];rows[1].user={_id:reader.id,username:reader.username};rows[1].rating=3;
  await mocks(page,rows);
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/books/${book}/reviews/mine`,async route=>{await pending;await route.fulfill({json:rows[1]});});
  let fail=true;
  const writes:unknown[]=[];
  await page.route(`**/api/books/${book}/reviews`,route=>{
    const data=route.request().postDataJSON();writes.push(data);
    if(fail)return route.fulfill({status:503,json:{error:'暂时无法保存，请重试'}});
    rows[1]={...rows[1],...data};return route.fulfill({status:201,json:rows[1]});
  });
  try{
    await page.goto(`${base}/book/${book}`);
    await page.getByRole('button',{name:'查看全部评论',exact:true}).click();
    const sheet=page.getByRole('dialog',{name:'全部评论'});
    await expect(sheet.getByRole('button',{name:'正在准备评论…'})).toBeDisabled();
    await expect(sheet.getByRole('textbox',{name:'写下你的评论'})).toHaveCount(0);
    release();
    const input=sheet.getByRole('textbox',{name:'写下你的评论'});
    await expect(input).toHaveValue('已经保存的短评');await input.click();
    await expect(sheet.getByRole('button',{name:'6 分（3 星）'})).toHaveAttribute('aria-pressed','true');
    await input.fill('字'.repeat(140)+'😀');
    await expect(sheet.getByRole('button',{name:'发布',exact:true})).toBeDisabled();
    await input.fill('修改后的短评😀');await sheet.getByRole('button',{name:'发布',exact:true}).click();
    await expect(sheet.getByRole('alert')).toContainText('暂时无法保存');await expect(input).toHaveValue('修改后的短评😀');
    fail=false;await sheet.getByRole('button',{name:'发布',exact:true}).click();
    await expect(sheet).toBeVisible();await expect(sheet.locator('[data-review-id="mine"] .book-review-content')).toHaveText('修改后的短评😀');
    expect(writes).toEqual([{rating:3,content:'修改后的短评😀'},{rating:3,content:'修改后的短评😀'}]);
    await input.click();
    const footer=sheet.locator('.book-review-composer');
    expect(await footer.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`verified-composer-${width}.png`)});
    await page.setViewportSize({width,height:500});
    await expect(sheet).toHaveCSS('height','475px');
    expect((await footer.boundingBox())!.y+(await footer.boundingBox())!.height).toBeLessThanOrEqual(501);
    await expect(input).toHaveValue('修改后的短评😀');
    await page.keyboard.press('Escape');await expect(sheet).toHaveCount(0);
  }finally{release();}
});

test('only repeated text is folded and can be expanded without losing records',async({page})=>{
  const rows=[row('one','内容相同'),row('two','内容相同'),row('three','不同的内容')];
  await mocks(page,rows);await page.route(`**/api/books/${book}/reviews/mine`,route=>route.fulfill({json:null}));
  await page.goto(`${base}/book/${book}`);await page.getByRole('button',{name:'查看全部评论',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'全部评论'});
  await expect(sheet.locator('.book-review')).toHaveCount(2);
  await sheet.getByRole('button',{name:'已折叠重复评论（1 条） · 展开'}).click();
  await expect(sheet.locator('.book-review')).toHaveCount(3);
  await sheet.getByRole('button',{name:'收起重复评论'}).click();await expect(sheet.locator('.book-review')).toHaveCount(2);
});

test('signed-in reader submits from the sheet through the real local API',async({page})=>{
  expect(new URL(base).hostname).toBe('127.0.0.1');
  await page.goto(`${base}/login`);
  await page.getByPlaceholder('请输入用户名').fill('山间读者');await page.getByPlaceholder('请输入密码').fill('Local-test-12345');
  await page.getByRole('button',{name:'立即登录',exact:true}).click();await expect(page).toHaveURL(base+'/');
  await page.goto(`${base}/book/${book}`);await page.getByRole('button',{name:'查看全部评论',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'全部评论'}),input=sheet.getByRole('textbox',{name:'写下你的评论'});
  await input.fill('通过底部输入框保存的本地验证评论。');
  await sheet.getByRole('button',{name:'8 分（4 星）'}).click();
  await sheet.getByRole('button',{name:'发布',exact:true}).click();
  await expect(input).toHaveValue('通过底部输入框保存的本地验证评论。');
  await expect.poll(async()=>((await (await page.request.get(`${base}/api/books/${book}/reviews/mine`)).json()).content)).toBe('通过底部输入框保存的本地验证评论。');
  await expect(sheet).toBeVisible();
});
