import {test,expect,type APIRequestContext} from '@playwright/test';
import crypto from 'node:crypto';

const base='http://127.0.0.1:3000';
let bookId='';const chapterIds:string[]=[];
async function write(request:APIRequestContext,path:string,data:object){
  const csrf=await (await request.get(base+'/api/auth/csrf')).json();
  return request.post(base+path,{data,headers:{origin:base,'x-csrf-token':csrf.csrfToken,'Idempotency-Key':crypto.randomUUID()}});
}
test.beforeAll(async({request})=>{
  expect((await write(request,'/api/auth/signin',{email:'reader@example.test',password:'Local-test-12345'})).ok()).toBe(true);
  const book=await write(request,'/api/books',{title:'连续翻页回归 '+Date.now(),description:'分页与缓存的合成测试书'});expect(book.ok()).toBe(true);bookId=(await book.json()).id;
  const content=Array.from({length:100},(_,index)=>`第${index+1}段。清晨的风穿过山林，行者沿着石阶慢慢向前走。每一行文字都应该完整显示，翻到最后一页也不能遮住右边的字，更不能凭空多出一张空白页面。`).join('\n\n');
  for(let number=1;number<=3;number++){
    const chapter=await write(request,'/api/chapters',{bookId,title:`第${number}章 山林远行`,chapter_number:number,content});expect(chapter.ok()).toBe(true);chapterIds.push((await chapter.json()).id);
  }
});
test.afterAll(async({request})=>{
  if(!bookId)return;
  expect((await write(request,'/api/auth/signin',{email:'reader@example.test',password:'Local-test-12345'})).ok()).toBe(true);
  const csrf=await (await request.get(base+'/api/auth/csrf')).json();
  expect((await request.delete(base+'/api/books/'+bookId,{headers:{origin:base,'x-csrf-token':csrf.csrfToken}})).ok()).toBe(true);
});

test('fractional widths never accumulate clipping or blank pages, and fitting bottom lines remain visible',async({browser})=>{
  test.setTimeout(180000);
  for(const [width,font] of [[320,22],[390,22],[413,26]]){
    const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:2.75,reducedMotion:'reduce'});
    await context.addInitScript(size=>{localStorage.setItem('reader_fontSizeNum',JSON.stringify(size));localStorage.setItem('has-seen-reading-hint','true');},font);
    const page=await context.newPage();
    try{
      await page.goto(`${base}/book/${bookId}/${chapterIds[0]}`);
      const root=page.locator('.reader-pages-root:visible'),number=root.locator('.reader-page-window > .reader-page-surface [data-reader-page]');
      await expect(root).toHaveAttribute('data-reader-ready','true');
      await page.addStyleTag({content:'.reader-frame{width:calc(100% - .625px)!important}nextjs-portal{display:none!important}'});
      await expect.poll(()=>root.locator('.reader-page-window > .reader-page-surface .reader-text-window').evaluate(el=>el.getBoundingClientRect().width%1)).not.toBe(0);
      const total=Number((await number.innerText()).split('/')[1]);expect(total).toBeGreaterThan(20);
      for(let n=1;n<=total;n++){
        await expect(number).toHaveText(`${n}/${total}`);
        const geometry=await root.locator('.reader-page-window > .reader-page-surface').evaluate(sheet=>{
          const box=sheet.querySelector('.reader-text-window')!.getBoundingClientRect();
          const rects=[...sheet.querySelectorAll('.reader-paragraph-text')].flatMap(el=>[...el.getClientRects()]).filter(rect=>rect.right>box.left+1 && rect.left<box.right-1 && rect.bottom>box.top && rect.top<box.bottom);
          const body=sheet.querySelector('.reader-columns')!,paragraph=sheet.querySelector('.reader-paragraph')!;
          return {lines:rects.length,left:Math.max(0,...rects.map(rect=>box.left-rect.left)),right:Math.max(0,...rects.map(rect=>rect.right-box.right)),bottom:Math.max(0,...rects.map(rect=>rect.bottom-box.bottom)),gap:box.bottom-Math.max(...rects.map(rect=>rect.bottom)),line:parseFloat(getComputedStyle(body).lineHeight),paragraph:parseFloat(getComputedStyle(paragraph).marginBottom)};
        });
        expect(geometry.lines).toBeGreaterThan(0);expect(geometry.left).toBeLessThan(.6);expect(geometry.right).toBeLessThan(.6);expect(geometry.bottom).toBeLessThan(.6);
        if(n<total)expect(geometry.gap).toBeLessThan(geometry.line+geometry.paragraph+1);
        if(n<total)await page.keyboard.press('ArrowRight');
      }
      await expect(root.locator('.reader-end')).toHaveCount(0);
    }finally{await context.close();}
  }
});

test('the whole sheet follows touch across cached chapters in both directions without route requests',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.addInitScript(id=>{localStorage.setItem(`reader-page:${id}`,JSON.stringify({fraction:.999}));localStorage.setItem('has-seen-reading-hint','true');},chapterIds[1]);
  const page=await context.newPage(),requests:string[]=[],errors:string[]=[];
  page.on('request',request=>requests.push(request.url()));page.on('pageerror',error=>errors.push(error.message));
  const root=page.locator('.reader-pages-root:visible'),number=root.locator('.reader-page-window > .reader-page-surface [data-reader-page]');
  try{
    await page.goto(`${base}/book/${bookId}/${chapterIds[1]}`);
    await expect(root).toHaveAttribute('data-reader-next',chapterIds[2]);await expect(root).toHaveAttribute('data-reader-previous',chapterIds[0]);
    await expect(number).toHaveText(/^(\d+)\/\1$/);
    await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
    const cdp=await context.newCDPSession(page);
    const touch=(type:'touchStart'|'touchMove'|'touchEnd',x=0,y=0)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
    const mark=requests.length;
    await touch('touchStart',310,12);await touch('touchMove',220,12);await touch('touchMove',150,12);
    await expect(root.locator('.reader-page-preview h1')).toHaveText('第3章 山林远行');
    await expect.poll(async()=>{
      const sheet=(await root.locator('.reader-page-window > .reader-page-surface').boundingBox())!,frame=(await root.locator('.reader-frame').boundingBox())!;
      return sheet.x-frame.x;
    }).toBeLessThan(-100);
    const sheet=(await root.locator('.reader-page-window > .reader-page-surface').boundingBox())!,frame=(await root.locator('.reader-frame').boundingBox())!;
    expect(sheet.y).toBe(frame.y);expect(sheet.height).toBe(frame.height);expect(sheet.x).toBeLessThan(frame.x-100);
    await touch('touchEnd');await expect(page).toHaveURL(`${base}/book/${bookId}/${chapterIds[2]}`);await expect(number).toHaveText(/^1\//);
    await touch('touchStart',65,12);await touch('touchMove',170,12);await touch('touchMove',320,12);await touch('touchEnd');
    await expect(page).toHaveURL(`${base}/book/${bookId}/${chapterIds[1]}`);await expect(number).toHaveText(/^(\d+)\/\1$/);
    expect(requests.slice(mark).filter(url=>url.includes('_rsc') || /\/api\/chapters\/[^/?]+\?navigation/.test(url))).toEqual([]);
    await page.goBack();await expect(page).toHaveURL(`${base}/book/${bookId}`);await expect(page.locator('.book-detail')).toBeVisible();
    await page.goForward();await expect(root).toHaveAttribute('data-reader-chapter',chapterIds[1]);await expect(number).toHaveText(/^(\d+)\/\1$/);
    expect(errors).toEqual([]);
  }finally{await context.close();}
});

test('an uncached failure keeps text readable, can retry, and cannot navigate after the reader is closed',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(()=>{
    localStorage.setItem('has-seen-reading-hint','true');
    Object.defineProperty(navigator,'connection',{value:{saveData:true,addEventListener(){},removeEventListener(){}}});
  });
  const page=await context.newPage();let attempts=0;
  await page.route(`**/api/chapters/${chapterIds[2]}?navigation=1`,async route=>{attempts++;if(attempts===1)await route.abort();else{await new Promise(resolve=>setTimeout(resolve,300));await route.continue();}});
  try{
    await page.goto(`${base}/book/${bookId}/${chapterIds[1]}`);await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready','true');
    await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
    await page.keyboard.press('Control+ArrowRight');await expect(page.locator('.reader-navigation-error[role=alert]')).toBeVisible();
    await expect(page.getByRole('heading',{name:'第2章 山林远行',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'重试',exact:true}).click();await expect(page).toHaveURL(`${base}/book/${bookId}/${chapterIds[2]}`);expect(attempts).toBe(2);
    await page.reload();await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready','true');
    await page.route(`**/api/chapters/${chapterIds[1]}?navigation=1`,async route=>{await new Promise(resolve=>setTimeout(resolve,600));await route.continue();});
    await page.keyboard.press('Control+ArrowLeft');await page.keyboard.press('m');await page.locator('.reader-return:visible').click();
    await expect(page).toHaveURL(`${base}/book/${bookId}`);await page.waitForTimeout(750);await expect(page).toHaveURL(`${base}/book/${bookId}`);
  }finally{await context.close();}
});
