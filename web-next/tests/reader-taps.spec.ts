import {test,expect,type Page,type BrowserContext} from '@playwright/test';

const base=process.env.READER_TAPS_BASE || 'http://127.0.0.1:3000';
const book=process.env.READER_TAPS_BOOK || '000000000000000000000101';
const chapter=process.env.READER_TAPS_CHAPTER || book;
const root=(page:Page)=>page.locator('.reader-pages-root:visible');
const frame=(page:Page)=>root(page).locator('.reader-page-window');
const number=(page:Page)=>frame(page).locator(':scope > .reader-page-surface [data-reader-page]');

test.use({isMobile:true,hasTouch:true});
test.setTimeout(30000);

async function enter(page:Page,mode:string,width:number){
  await page.setViewportSize({width,height:844});
  await page.addInitScript(mode=>{
    localStorage.setItem('reader_turnMode',JSON.stringify(mode));
    localStorage.setItem('has-seen-reading-hint','true');
  },mode);
  await page.route('**/api/books/*/views',route=>route.fulfill({json:{success:true,counted:false}}));
  await page.goto(`${base}/book/${book}/${chapter}`);
  await expect(root(page)).toHaveAttribute('data-reader-ready','true');
  await expect(root(page)).toHaveAttribute('data-mode',mode);
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  return (await frame(page).boundingBox())!;
}

for(const mode of ['horizontal','vertical','scroll']){
  test(`${mode} keeps the long-press menu on release and accepts a fresh dismiss tap`,async({page,context})=>{
    const box=await enter(page,mode,390);
    const paragraph=(await frame(page).locator(':scope > .reader-page-surface .reader-paragraph').first().boundingBox())!;
    const x=Math.max(box.x+30,paragraph.x+30),y=Math.max(box.y+30,paragraph.y+12);
    const cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    await expect(page.getByRole('menu',{name:'段落操作'})).toBeVisible();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(page.getByRole('menu',{name:'段落操作'})).toBeVisible();
    await page.touchscreen.tap(box.x+box.width/2,box.y+box.height*.8);
    await expect(page.getByRole('menu',{name:'段落操作'})).toHaveCount(0);
    await expect(page.locator('.reader-tools')).toHaveAttribute('aria-hidden','true');
    await expect(number(page)).toHaveText(/^1\//);
    await cdp.detach();
  });
}

async function swipe(page:Page,context:BrowserContext,mode:string,reverse=false,short=false){
  const box=(await frame(page).boundingBox())!;
  const x=box.x+box.width*(mode==='horizontal'?(reverse?.25:.75):.5);
  const y=box.y+box.height*(mode==='horizontal'?.5:reverse?.25:.75);
  const distance=(mode==='horizontal'?box.width:box.height)*(short?.04:.45)*(reverse?1:-1);
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  for(let step=1;step<=4;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(mode==='horizontal'?distance*step/4:0),y:y+(mode==='horizontal'?0:distance*step/4),id:1}]});
  if(short)await page.waitForTimeout(110); // Release without flick velocity.
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await cdp.detach();
}

for(const width of [320,390]){
  for(const mode of ['horizontal','vertical']){
    test(`${width}px ${mode} accepts a fresh menu tap immediately after either swipe direction`,async({page,context})=>{
      const box=await enter(page,mode,width);
      for(const reverse of [false,true]){
        await swipe(page,context,mode,reverse);
        // Raw touch input has no locator stability wait: this is a new gesture
        // during the settling animation, before the old 200 ms guard expires.
        await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
        await expect(page.locator('.reader-tools')).toHaveAttribute('aria-hidden','false',{timeout:500});
        await expect(number(page)).toHaveText(reverse?/^1\//:/^2\//);
        await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
        await expect(page.locator('.reader-tools')).toHaveAttribute('aria-hidden','true');
      }
    });

    test(`${width}px ${mode} accepts an immediate next-page tap and suppresses only the drag click`,async({page,context})=>{
      const box=await enter(page,mode,width);
      await swipe(page,context,mode);
      await page.touchscreen.tap(box.x+box.width*.85,box.y+box.height*.85);
      await expect(number(page)).toHaveText(/^3\//,{timeout:700});
      await expect(frame(page)).not.toHaveAttribute('data-turning');
      await expect(root(page).locator('.reader-page-preview')).toBeEmpty();
      await expect(page.locator('.reader-tools')).toHaveAttribute('aria-hidden','true');
      await swipe(page,context,mode,false,true);
      await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
      await expect(page.locator('.reader-tools')).toHaveAttribute('aria-hidden','false',{timeout:500});
      await expect(number(page)).toHaveText(/^3\//);
    });
  }

  test(`${width}px native scroll accepts the next deliberate tap without a cooldown`,async({page,context})=>{
    const box=await enter(page,'scroll',width);
    await root(page).locator('.reader-scroll-window').evaluate(el=>{
      Object.assign(window,{readerScrollEnded:new Promise<void>(resolve=>el.addEventListener('scrollend',()=>resolve(),{once:true}))});
    });
    await swipe(page,context,'scroll');
    await expect(root(page).locator('.reader-scroll-window')).not.toHaveJSProperty('scrollTop',0);
    // Let native momentum end; the last scroll event must not impose another
    // 200 ms reader cooldown. A wheel/programmatic scroll has the same handler.
    await page.evaluate(()=>(window as unknown as {readerScrollEnded:Promise<void>}).readerScrollEnded);
    await root(page).locator('.reader-scroll-window').evaluate(async el=>{
      el.scrollTo({top:el.scrollTop+1,behavior:'instant'});
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    });
    await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
    await expect(page.locator('.reader-tools')).toHaveAttribute('aria-hidden','false',{timeout:500});
  });
}
