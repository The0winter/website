import {test,expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';
const base=process.env.REVIEW_BASE||'http://127.0.0.1:3157',book=process.env.REVIEW_BOOK||'000000000000000000000101';
const reader={id:'000000000000000000000011',username:'山间读者',role:'reader'};
const review={_id:'000000000000000000000301',rating:4,content:'文字很有画面感，像是和老朋友一起旅行。',createdAt:'2026-09-28T10:00:00Z',user:{_id:'000000000000000000000012',username:'月下听风'},replyCount:12,replyPreview:{_id:'preview',content:'喜欢这种娓娓道来的感觉，读完还想再看一遍。',createdAt:'2026-09-28T11:00:00Z',user:{_id:reader.id,username:reader.username}}};
async function setup(page:Page) {
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:reader,profile:reader}}));
  await page.route('**/api/auth/csrf',r=>r.fulfill({json:{csrfToken:'test'}}));
  await page.route('**/api/books/*/reviews/mine',r=>r.fulfill({json:null}));
  await page.route('**/api/books/*/review-reactions?*',r=>r.fulfill({json:[{id:review._id,likes:28,dislikes:0,reaction:null}]}));
  await page.route('**/api/books/*/reviews?*',r=>r.fulfill({json:[review],headers:{'X-Total-Count':'1','X-Review-Distribution':'{"4":1}'}}));
}
for(const width of [320,390,1440])test(`reply drafting, retry, nested preview and read-only thread at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:844});await setup(page);
  let fail=true;
  const writes:{content:string;requestId:string}[]=[],reads:string[]=[];
  const replies=Array.from({length:12},(_,i)=>({...review.replyPreview,_id:`reply-${i}`,content:`${i+1} · 我也很喜欢这段旅程，人物之间的相处自然又温暖。`}));
  await page.route(`**/api/books/${book}/reviews/${review._id}/replies*`,r=>{
    if(r.request().method()==='POST'){
      const body=r.request().postDataJSON();writes.push(body);
      return r.fulfill(fail?{status:503,json:{error:'暂时无法发送，请重试'}}:{status:201,json:{reply:{...review.replyPreview,_id:'my-reply',content:body.content},total:13}});
    }
    const cursor=new URL(r.request().url()).searchParams.get('cursor')||'';reads.push(cursor);
    return r.fulfill({json:{items:cursor?replies.slice(10):replies.slice(0,10),cursor:cursor?null:'next',total:12}});
  });
  await page.goto(`${base}/book/${book}`);await page.getByRole('button',{name:'查看全部评论',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'全部评论'});
  await expect(sheet.locator('.book-review')).toHaveCount(1);
  await sheet.getByRole('button',{name:'回复',exact:true}).click();
  const input=sheet.getByPlaceholder('回复 月下听风');await expect(input).toBeFocused();await expect(input).toHaveValue('');
  await input.fill('读完这章忍不住想和大家分享 😊');
  await sheet.getByRole('button',{name:'发送',exact:true}).click();await expect(sheet.getByRole('alert')).toContainText('暂时无法发送');
  await expect(input).toHaveValue('读完这章忍不住想和大家分享 😊');
  fail=false;await sheet.getByRole('button',{name:'发送',exact:true}).click();
  await expect(sheet.locator('[data-reply-id="my-reply"]')).toBeVisible();expect(writes[0]).toEqual(writes[1]);
  const parent=sheet.locator('.book-review-avatar-wrap').first(),nested=sheet.locator('[data-reply-id="my-reply"] .book-review-avatar-wrap');
  expect((await nested.boundingBox())!.x).toBeGreaterThan((await parent.boundingBox())!.x+25);
  await expect(sheet.getByRole('button',{name:'查看 13 条回复'})).toBeVisible();
  await page.screenshot({path:info.outputPath(`verified-reply-preview-${width}.png`)});
  await sheet.getByRole('button',{name:'查看 13 条回复'}).click();await expect(sheet.getByRole('heading',{name:'评论回复'})).toBeVisible();
  await expect(sheet.locator('.book-review-thread-list .book-review-reply')).toHaveCount(10);
  await expect(sheet.getByRole('textbox')).toHaveCount(0);await expect(sheet.getByRole('button',{name:'回复',exact:true})).toBeHidden();
  await sheet.getByRole('button',{name:'加载更多回复'}).click();await expect(sheet.locator('.book-review-thread-list .book-review-reply')).toHaveCount(12);expect(reads).toEqual(['','next']);
  await sheet.locator('.book-review-thread').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:info.outputPath(`verified-readonly-thread-${width}.png`)});
  await sheet.getByRole('button',{name:'返回全部评论'}).click();await expect(sheet.locator('[data-reply-id="my-reply"]')).toBeVisible();
  expect(await sheet.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('every cached opening starts with the same skeleton and no comment content',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await setup(page);await page.goto(`${base}/book/${book}`);
  const opener=page.getByRole('button',{name:'查看全部评论',exact:true});
  for(let i=0;i<2;i++){
    await opener.click();const sheet=page.getByRole('dialog',{name:'全部评论'});
    await expect(sheet.locator('.book-review-skeleton')).toBeVisible();await expect(sheet.locator('.book-review')).toHaveCount(0);
    if(i===0)await page.screenshot({path:info.outputPath('verified-skeleton.png')});
    await expect(sheet.locator('.book-review')).toHaveCount(1);
    await sheet.getByRole('button',{name:'关闭全部评论'}).click();await expect(sheet).toHaveCount(0);
  }
});

test('a reply sent through the real local API survives closing and reopening',async({page})=>{
  test.skip(!base.startsWith('http://127.0.0.1:'),'Synthetic local database only');
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${base}/book/${book}`);
  await page.evaluate(async()=>{
    const csrf=await fetch('/api/auth/csrf').then(r=>r.json());
    const response=await fetch('/api/auth/signin',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':csrf.csrfToken},body:JSON.stringify({email:'reader@example.test',password:'Local-test-12345'})});
    if(!response.ok)throw Error('Fixture login failed');
  });
  await page.reload();await page.getByRole('button',{name:'查看全部评论',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'全部评论'});
  await sheet.getByRole('button',{name:'回复',exact:true}).first().click();
  const message=`仅在隔离库中验证回复保存 ${Date.now()}`;
  await sheet.locator('.book-review-reply-composer textarea').fill(message);
  await sheet.getByRole('button',{name:'发送',exact:true}).click();await expect(sheet.getByText(message,{exact:true})).toBeVisible();
  await sheet.getByRole('button',{name:'关闭全部评论'}).click();await expect(sheet).toHaveCount(0);
  await page.reload();await page.getByRole('button',{name:'查看全部评论',exact:true}).click();await expect(sheet.getByText(message,{exact:true})).toBeVisible();
});
