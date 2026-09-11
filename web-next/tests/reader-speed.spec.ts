import {test,expect} from '@playwright/test';

const base=process.env.READER_SPEED_BASE || 'http://127.0.0.1:3000';
const book=process.env.READER_SPEED_BOOK || '000000000000000000000101';
const chapter=process.env.READER_SPEED_CHAPTER || '000000000000000000000101';
const url=`${base}/book/${book}/${chapter}`;

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('has-seen-reading-hint','true'));
  await page.route('**/api/books/*/views',route=>route.fulfill({json:{success:true,counted:false}}));
});

for(const width of [320,1440]){
  test(`settings keep their controls without a redundant title at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:844});
    await page.goto(url);
    const reader=page.locator('.reader-pages-root:visible');
    await expect(reader).toHaveAttribute('data-reader-ready','true');
    await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
    await page.keyboard.press('m');
    await page.locator('.reader-tools:visible').getByRole('button',{name:'设置',exact:true}).click();
    await expect(page.getByText('阅读设置',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'左右翻页',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'上下滚屏',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'上下翻页',exact:true}).click();
    await expect(reader).toHaveAttribute('data-mode','vertical');
    await expect(page.getByRole('button',{name:'关闭阅读设置'})).toBeVisible();
    await page.screenshot({path:`../artifacts/reader-speed-${base.includes('127.0.0.1')?'local':'live'}-settings-${width}.png`});
    await page.getByRole('button',{name:'关闭阅读设置'}).click();
    await expect(page.getByRole('button',{name:'左右翻页',exact:true})).toHaveCount(0);
  });
}

for(const mode of ['horizontal','vertical']){
  test(`${mode} turns accept rapid clicks, keys and a click after dragging without double turns`,async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.addInitScript(value=>localStorage.setItem('reader_turnMode',JSON.stringify(value)),mode);
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);
    const reader=page.locator('.reader-pages-root:visible');
    const frame=reader.locator('.reader-page-window');
    const number=frame.locator(':scope > .reader-page-surface [data-reader-page]');
    await expect(reader).toHaveAttribute('data-reader-ready','true');
    await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
    await expect(reader).toHaveAttribute('data-mode',mode);
    await expect(number).not.toHaveText('1/1');
    // Use a 200 ms turn plus one display frame of scheduling tolerance.
    const interval=225;
    const box=(await frame.boundingBox())!;
    const next={x:box.x+box.width*.85,y:box.y+box.height*.85};
    const previous={x:box.x+box.width*.15,y:box.y+box.height*.15};
    for(let i=0;i<4;i++){
      await page.mouse.click(next.x,next.y);
      await page.waitForTimeout(interval);
    }
    await expect(number).toHaveText(/^5\//);
    for(let i=0;i<4;i++){
      await page.keyboard.press(mode==='horizontal'?'ArrowLeft':'ArrowUp');
      await page.waitForTimeout(interval);
    }
    await expect(number).toHaveText(/^1\//);
    // Drag forward, then release: the synthesized click must not turn back.
    await page.mouse.move(next.x,next.y);
    await page.mouse.down();
    await page.mouse.move(mode==='horizontal'?previous.x:next.x,mode==='vertical'?previous.y:next.y,{steps:3});
    await page.mouse.up();
    await page.waitForTimeout(interval);
    expect(await number.innerText()).toMatch(/^2\//);
    // The old 600 ms suppression swallowed this separate tap.
    await page.mouse.click(next.x,next.y);
    await page.waitForTimeout(interval);
    expect(await number.innerText()).toMatch(/^3\//);
    await expect(frame).not.toHaveAttribute('data-turning');
    await expect(reader.locator('.reader-page-preview')).toBeEmpty();
    expect(errors).toEqual([]);
  });
}
