import {test,expect} from '@playwright/test';

const base='http://127.0.0.1:3000';
const url=base+'/book/000000000000000000000101/000000000000000000000101';

test('touch hold survives release, marks persist, swipes page, and exiting restores scrolling',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.addInitScript(()=>localStorage.setItem('has-seen-reading-hint','true'));
  const page=await context.newPage();
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(url);
    await expect(page.locator('.reader-page-window > .reader-page-surface [data-reader-page]:visible')).not.toHaveText('1/1');
    await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
    const paragraph=page.locator('.reader-pages-root:visible .reader-paragraph').first();
    const box=(await paragraph.boundingBox())!;
    const cdp=await context.newCDPSession(page);
    const touch=(type:'touchStart'|'touchMove'|'touchEnd',x=0,y=0)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
    await touch('touchStart',box.x+80,box.y+20);
    await page.getByRole('menu',{name:'段落操作'}).waitFor();
    await touch('touchEnd');
    await page.getByRole('menuitem',{name:'标记',exact:true}).tap();
    await expect(paragraph).toHaveAttribute('data-marked','true');
    await page.reload();
    await expect(paragraph).toHaveAttribute('data-marked','true');
    await touch('touchStart',320,450);await touch('touchMove',220,450);await touch('touchMove',80,450);await touch('touchEnd');
    await expect(page.locator('.reader-page-window > .reader-page-surface [data-reader-page]:visible')).toHaveText(/^2\//);
    await expect(page.locator('.reader-status-top')).toHaveAttribute('data-open','false');
    const fraction=await page.locator('.reader-page-window > .reader-page-surface [data-reader-page]:visible').innerText();
    await page.reload();await expect(page.locator('.reader-page-window > .reader-page-surface [data-reader-page]:visible')).toHaveText(fraction);
    await page.keyboard.press('m');
    await expect(page.locator('.reader-return:visible')).toHaveText('第1章 山间来信');
    await page.locator('.reader-return:visible').click();
    await expect(page).toHaveURL(base+'/book/000000000000000000000101');
    await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.body).overflow)).not.toBe('hidden');
    expect(errors).toEqual([]);
  }finally{await context.close();}
});

test('immersive navigation, touch-following turns, cancellation and all three saved modes',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.addInitScript(()=>localStorage.setItem('has-seen-reading-hint','true'));
  const page=await context.newPage();
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const reader=page.locator('.reader-pages-root:visible'),viewport=reader.locator('.reader-page-window');
  const pageNumber=reader.locator('.reader-page-window > .reader-page-surface [data-reader-page]');
  const textWindow=reader.locator('.reader-text-window').first();
  const cdp=await context.newCDPSession(page);
  const touch=(type:'touchStart'|'touchMove'|'touchEnd'|'touchCancel',x=0,y=0)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:['touchEnd','touchCancel'].includes(type)?[]:[{x,y,id:1}]});
  async function choose(label:string,mode:string){
    await page.keyboard.press('m');
    await page.locator('.reader-tools:visible').getByRole('button',{name:'设置',exact:true}).tap();
    await page.getByRole('button',{name:label,exact:true}).tap();
    await expect(reader).toHaveAttribute('data-mode',mode);
    await expect(page.getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'关闭阅读设置'}).tap();
    await page.keyboard.press('Escape');
  }
  try{
    await page.goto(url);await expect(reader).toHaveAttribute('data-reader-ready','true');
    await expect(pageNumber).not.toHaveText('1/1');
    await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
    await expect(reader.locator('time,.reader-battery,.reader-page-controls')).toHaveCount(0);
    await expect(reader.locator('.reader-return')).toBeHidden();
    const initialBox=await viewport.boundingBox();
    await viewport.tap({position:{x:175,y:330}});
    await expect(reader.locator('.reader-return')).toBeVisible();
    expect(await viewport.boundingBox()).toEqual(initialBox);
    await viewport.tap({position:{x:175,y:330}});
    await expect(reader.locator('.reader-return')).toBeHidden();
    const first=await pageNumber.innerText();
    // A slow, short drag must follow the finger then return to the same page.
    await touch('touchStart',310,420);await touch('touchMove',280,420);
    await expect(viewport).toHaveAttribute('data-turning','dragging');
    expect(await reader.locator('.reader-page-window > .reader-page-surface').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m41)).toBeLessThan(-15);
    await page.waitForTimeout(150);await touch('touchEnd');
    await expect(viewport).not.toHaveAttribute('data-turning');
    await expect(pageNumber).toHaveText(first);
    await touch('touchStart',310,420);await touch('touchMove',240,420);await touch('touchMove',65,420);await touch('touchEnd');
    await expect(pageNumber).toHaveText(/^2\//);
    await expect(reader.locator('.reader-page-preview')).toBeEmpty();
    await choose('上下翻页','vertical');
    const beforeVertical=await pageNumber.innerText();
    await touch('touchStart',190,650);await touch('touchMove',190,550);
    expect(await reader.locator('.reader-page-window > .reader-page-surface').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m42)).toBeLessThan(-50);
    await touch('touchCancel');await expect(viewport).not.toHaveAttribute('data-turning');
    await expect(pageNumber).toHaveText(beforeVertical);
    await touch('touchStart',190,650);await touch('touchMove',190,450);await touch('touchMove',190,160);await touch('touchEnd');
    await expect(pageNumber).toHaveText(/^3\//);
    await page.reload();await expect(reader).toHaveAttribute('data-mode','vertical');await expect(pageNumber).toHaveText(/^3\//);
    await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
    await choose('上下滚屏','scroll');
    const beforeScroll=await textWindow.evaluate(el=>el.scrollTop);
    await touch('touchStart',190,650);await touch('touchMove',190,520);await touch('touchMove',190,330);await touch('touchEnd');
    await expect.poll(()=>textWindow.evaluate(el=>el.scrollTop)).toBeGreaterThan(beforeScroll+100);
    await expect(page.getByRole('menu',{name:'段落操作'})).toHaveCount(0);
    // Let native inertia settle before checking an exact sub-page offset.
    await textWindow.evaluate(el=>new Promise<void>(resolve=>{const timer=setTimeout(resolve,1800);el.addEventListener('scrollend',()=>{clearTimeout(timer);resolve();},{once:true});}));
    await textWindow.evaluate(el=>{el.scrollTo({top:840,behavior:'instant'});el.dispatchEvent(new Event('scroll'));});
    await expect.poll(()=>textWindow.evaluate(el=>Math.round(el.scrollTop))).toBe(840);
    await page.reload();await expect(reader).toHaveAttribute('data-mode','scroll');
    await expect.poll(()=>textWindow.evaluate(el=>Math.round(el.scrollTop))).toBe(840);
    await textWindow.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    await expect(pageNumber).toHaveText(/^(\d+)\/\1$/);
    await touch('touchStart',190,650);await touch('touchMove',190,520);await touch('touchMove',190,350);await touch('touchEnd');
    await expect(page).toHaveURL(base+'/book/000000000000000000000101/000000000000000000000102');
    await expect(reader).toHaveAttribute('data-mode','scroll');
    await expect.poll(()=>textWindow.evaluate(el=>Math.round(el.scrollTop))).toBe(0);
    // Pull down from the beginning returns to the previous chapter's end.
    await touch('touchStart',190,300);await touch('touchMove',190,400);await touch('touchMove',190,600);await touch('touchEnd');
    await expect(page).toHaveURL(url);
    await expect(pageNumber).toHaveText(/^(\d+)\/\1$/);
    expect(errors).toEqual([]);
  }finally{await context.close();}
});
