import {test,expect,type Page} from '@playwright/test';

const base=process.env.READER_SCROLL_BASE || 'http://127.0.0.1:3000';
const book=process.env.READER_SCROLL_BOOK || '000000000000000000000101';
const first=process.env.READER_SCROLL_CHAPTER || '000000000000000000000101';
const url=`${base}/book/${book}/${first}`;
const root=(page:Page)=>page.locator('.reader-pages-root:visible');
const viewport=(page:Page)=>root(page).locator('.reader-scroll-window');
const section=(page:Page,id:string)=>viewport(page).locator(`[data-scroll-chapter="${id}"]`);
test.use({actionTimeout:12000,hasTouch:true});
test.setTimeout(30000);

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('reader_turnMode',JSON.stringify('scroll'));localStorage.setItem('has-seen-reading-hint','true');});
  await page.route('**/api/books/*/views',route=>route.fulfill({json:{success:true,counted:false}}));
});
async function enter(page:Page,width=390){
  await page.setViewportSize({width,height:844});await page.goto(url);
  await expect(root(page)).toHaveAttribute('data-reader-ready','true');
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  await expect(root(page)).toHaveAttribute('data-reader-next',/.+/);
  const next=(await root(page).getAttribute('data-reader-next'))!;
  await expect(section(page,next)).toHaveCount(1);return next;
}
async function atBoundary(page:Page,id:string,offset:number){
  await section(page,id).evaluate((el,offset)=>{el.parentElement!.scrollTop=(el as HTMLElement).offsetTop+offset;},offset);
}

for(const width of [320,390,1440]){
  test(`seamless wheel scrolling keeps both chapter texts and the same viewport at ${width}px`,async({page})=>{
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const next=await enter(page,width),view=viewport(page),handle=await view.elementHandle();
    const height=await view.evaluate(el=>el.clientHeight);
    await atBoundary(page,next,-height/2);
    await expect(section(page,next).locator('h1')).toBeVisible();
    expect(await section(page,first).locator('p').last().evaluate(el=>el.getBoundingClientRect().bottom)).toBeGreaterThan(0);
    await page.screenshot({path:`../artifacts/reader-scroll-${base.includes('127.0.0.1')?'local':'live'}-boundary-${width}.png`});
    const top=await view.evaluate(el=>el.scrollTop);
    const box=(await view.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.wheel(0,height*.7);
    await expect(root(page)).toHaveAttribute('data-reader-chapter',next);
    expect(await handle!.evaluate(el=>el.isConnected)).toBe(true);
    expect(await view.evaluate(el=>el.scrollTop)).toBeGreaterThan(top+height*.6);
    await page.mouse.wheel(0,-height*.6);
    await expect(root(page)).toHaveAttribute('data-reader-chapter',first);
    expect(await handle!.evaluate(el=>el.isConnected)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('one touch crosses the chapter before release without resetting native scrolling',async({page,context})=>{
  await page.addInitScript(()=>{
    const writes:number[]=[];Object.assign(window,{readerScrollWrites:writes});
    const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop')!;
    Object.defineProperty(Element.prototype,'scrollTop',{...descriptor,set(value){if(this.classList.contains('reader-scroll-window'))writes.push(value);descriptor.set!.call(this,value);}});
  });
  const next=await enter(page),view=viewport(page),handle=await view.elementHandle();
  await atBoundary(page,next,-160);
  await page.evaluate(()=>{(window as unknown as {readerScrollWrites:number[]}).readerScrollWrites.length=0;});
  const cdp=await context.newCDPSession(page);
  const touch=(type:'touchStart'|'touchMove'|'touchEnd',y=0)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:180,y,id:1}]});
  await touch('touchStart',680);await page.waitForTimeout(30);
  await touch('touchMove',560);await page.waitForTimeout(30);
  await touch('touchMove',410);
  await expect(root(page)).toHaveAttribute('data-reader-chapter',next);
  expect(await handle!.evaluate(el=>el.isConnected)).toBe(true);
  await page.waitForTimeout(30);await touch('touchMove',250);
  const beforeRelease=await view.evaluate(el=>el.scrollTop);
  await touch('touchEnd');
  await page.waitForTimeout(250);
  expect(await view.evaluate(el=>el.scrollTop)).toBeGreaterThanOrEqual(beforeRelease);
  // Chrome's synthetic touch input need not fling; no JS offset writes may
  // interrupt a real device's native momentum at this chapter boundary.
  expect(await page.evaluate(()=>(window as unknown as {readerScrollWrites:number[]}).readerScrollWrites)).toEqual([]);
  await expect(page.getByRole('menu',{name:'段落操作'})).toHaveCount(0);
});

test('long-press marks and paragraph comments belong to the chapter reached by scrolling',async({page,context})=>{
  const next=await enter(page);await atBoundary(page,next,80);
  await expect(root(page)).toHaveAttribute('data-reader-chapter',next);
  const paragraph=section(page,next).locator('p').first(),box=(await paragraph.boundingBox())!;
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+60,y:box.y+15,id:1}]});
  await expect(page.getByRole('menu',{name:'段落操作'})).toBeVisible();
  await page.waitForTimeout(300);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.getByRole('menuitem',{name:'标记',exact:true}).click();
  await expect(paragraph).toHaveAttribute('data-marked','true');
  await page.reload();await expect(root(page)).toHaveAttribute('data-reader-ready','true');
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  await expect(paragraph).toHaveAttribute('data-marked','true');
  const requests:string[]=[];page.on('request',request=>requests.push(request.url()));
  await paragraph.click({button:'right'});await page.getByRole('menuitem',{name:'评论',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(()=>requests.some(url=>url.includes(`/api/chapters/${next}/paragraph-comments/`))).toBe(true);
});

test('scrolling retains its position through reload, mode changes and bounded chapter pruning',async({page})=>{
  let next=await enter(page);const handle=await viewport(page).elementHandle();
  for(let index=0;index<7;index++){
    await expect(section(page,next)).toHaveCount(1);
    await atBoundary(page,next,220);
    await expect(root(page)).toHaveAttribute('data-reader-chapter',next);
    const heading=section(page,next).locator('h1'),before=await heading.evaluate(el=>el.getBoundingClientRect().top);
    await expect.poll(()=>viewport(page).locator('[data-scroll-chapter]').count()).toBeLessThanOrEqual(5);
    await page.waitForTimeout(260);
    expect(Math.abs(await heading.evaluate(el=>el.getBoundingClientRect().top)-before)).toBeLessThan(1.5);
    expect(await handle!.evaluate(el=>el.isConnected)).toBe(true);
    if(index<6){await expect(root(page)).toHaveAttribute('data-reader-next',/.+/);next=(await root(page).getAttribute('data-reader-next'))!;}
  }
  const before=await section(page,next).locator('h1').evaluate(el=>el.getBoundingClientRect().top);
  await page.reload();await expect(root(page)).toHaveAttribute('data-reader-ready','true');
  await expect.poll(async()=>Math.abs(await section(page,next).locator('h1').evaluate(el=>el.getBoundingClientRect().top)-before)).toBeLessThan(2);
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  await page.keyboard.press('m');await page.locator('.reader-tools:visible').getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'左右翻页',exact:true}).click();await expect(root(page)).toHaveAttribute('data-mode','horizontal');
  await page.getByRole('button',{name:'上下滚屏',exact:true}).click();await expect(root(page)).toHaveAttribute('data-mode','scroll');
  await expect(section(page,next)).toHaveCount(1);
  await page.getByRole('button',{name:'关闭阅读设置'}).click();
  await page.goBack();await expect(page).toHaveURL(`${base}/book/${book}`);
  await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.body).overflow)).not.toBe('hidden');
});

for(const width of [320,1440]){
  test(`administrator settings omit the administrator notice at ${width}px`,async({page})=>{
    const account={id:'000000000000000000000001',username:'管理员回归',role:'admin',email:'admin@example.test'};
    await page.route('**/api/auth/session',route=>route.fulfill({json:{user:account,profile:account}}));
    await enter(page,width);await page.keyboard.press('m');
    await page.locator('.reader-tools:visible').getByRole('button',{name:'设置',exact:true}).click();
    await expect(page.getByRole('button',{name:'关闭阅读设置'})).toBeVisible();
    await expect(page.locator('[data-admin-mode]')).toHaveCount(0);
    await expect(page.getByText('管理员模式',{exact:false})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'上下滚屏',exact:true})).toBeVisible();
  });
}

test('slow paragraph counts do not hold back the next chapter text',async({page})=>{
  let release:()=>void=()=>{};
  const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/paragraph-comments',async route=>{await pending;await route.fulfill({json:{counts:{}}});});
  try{const next=await enter(page);await expect(section(page,next).locator('p').first()).toBeAttached();}
  finally{release();}
});

test('a failed next chapter can retry without losing current text',async({page})=>{
  let failing=true;
  await page.route('**/api/chapters/*?navigation=1',route=>{
    if(!route.request().url().includes(first) && failing)return route.abort();
    return route.continue();
  });
  await page.setViewportSize({width:390,height:844});await page.goto(url);
  await expect(root(page)).toHaveAttribute('data-reader-ready','true');
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  await page.waitForTimeout(400);
  const load=page.getByRole('button',{name:'加载下一章',exact:true});await load.scrollIntoViewIfNeeded();await load.click();
  await expect(page.locator('.reader-navigation-error')).toBeVisible();
  await expect(section(page,first)).toHaveCount(1);
  failing=false;
  await page.getByRole('button',{name:'重试',exact:true}).click();
  await expect(root(page)).not.toHaveAttribute('data-reader-chapter',first);
  await expect(page.locator('.reader-navigation-error')).toHaveCount(0);
});
