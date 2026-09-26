import {test,expect} from './fixtures/without-analytics';

const base=process.env.REVIEW_BASE||'http://127.0.0.1:3157',book=process.env.REVIEW_BOOK||'000000000000000000000101';
test('failed incremental loads retain comments, retry in place and bound reaction requests',async({page})=>{
  await page.setViewportSize({width:390,height:900});
  const rows=Array.from({length:29},(_,i)=>({_id:(i+1).toString(16).padStart(24,'0'),rating:4,content:`第${i+1}条评论。`+'用于验证全文展开和滚动续载。'.repeat(7),user:{_id:'000000000000000000000001',username:`测试书友${i}`},createdAt:'2026-09-26T10:00:00Z'}));
  let fail=true,appendReads=0;
  const reactions:number[]=[],reads:{offset:number;limit:number}[]=[];
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:null}}));
  await page.route(`**/api/books/${book}/reviews?*`,route=>{
    const url=new URL(route.request().url()),offset=Number(url.searchParams.get('cursor')||0),limit=Number(url.searchParams.get('limit'));
    reads.push({offset,limit});
    if(offset===5){appendReads++;if(fail)return route.fulfill({status:503,json:{error:'暂不可用'}});}
    return route.fulfill({json:rows.slice(offset,offset+limit),headers:{'X-Total-Count':'29','X-Next-Cursor':offset+limit<rows.length?String(offset+limit):'','X-Review-Distribution':'{"4":29}'}});
  });
  await page.route(`**/api/books/${book}/review-reactions?*`,route=>{
    const ids=new URL(route.request().url()).searchParams.get('ids')!.split(',');reactions.push(ids.length);
    return route.fulfill({json:ids.map(id=>({id,likes:0,dislikes:0,reaction:null}))});
  });
  await page.goto(`${base}/book/${book}`);await expect(page.locator('#reviews-panel .book-review')).toHaveCount(2);
  await page.getByRole('button',{name:'查看全部评论',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'全部评论'}),body=sheet.locator('.book-review-sheet-body');
  await expect(sheet.locator('.book-review')).toHaveCount(5);
  await body.evaluate(el=>el.scrollTop=el.scrollHeight);
  await expect(sheet.getByRole('alert')).toContainText('评论加载失败');
  await expect(sheet.locator('.book-review')).toHaveCount(5);expect(appendReads).toBe(1);
  fail=false;await sheet.getByRole('button',{name:'重试',exact:true}).click();
  await expect(sheet.locator('.book-review')).toHaveCount(10);
  for(const expected of [15,20,25,29]){await body.evaluate(el=>el.scrollTop=el.scrollHeight);await expect(sheet.locator('.book-review')).toHaveCount(expected);}
  expect(new Set(await sheet.locator('.book-review').evaluateAll(nodes=>nodes.map(el=>el.getAttribute('data-review-id')))).size).toBe(29);
  expect(reads).toEqual([{offset:0,limit:2},{offset:2,limit:3},{offset:5,limit:5},{offset:5,limit:5},{offset:10,limit:5},{offset:15,limit:5},{offset:20,limit:5},{offset:25,limit:5}]);
  expect(Math.max(...reactions)).toBeLessThanOrEqual(20);
  await sheet.getByRole('button',{name:'关闭全部评论'}).click();await expect(sheet).toHaveCount(0);
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
});
