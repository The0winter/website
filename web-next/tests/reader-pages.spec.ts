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
    await expect(page.locator('[data-reader-page]:visible')).not.toHaveText('1/1');
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
    await expect(page.locator('[data-reader-page]:visible')).toHaveText(/^2\//);
    await expect(page.locator('.reader-return:visible')).toHaveText('第1章 山间来信');
    const fraction=await page.locator('[data-reader-page]:visible').innerText();
    await page.reload();await expect(page.locator('[data-reader-page]:visible')).toHaveText(fraction);
    await page.locator('.reader-return:visible').click();
    await expect(page).toHaveURL(base+'/book/000000000000000000000101');
    await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.body).overflow)).not.toBe('hidden');
    expect(errors).toEqual([]);
  }finally{await context.close();}
});
