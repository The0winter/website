import {test,expect} from './fixtures/without-analytics';

const base=process.env.REVIEW_TEST_BASE || 'http://127.0.0.1:3157';
const book=process.env.REVIEW_TEST_BOOK || '000000000000000000000101';
const total=Number(process.env.REVIEW_TEST_TOTAL || 6);
for(const width of [390,1440]) {
  test(`review preview and incremental sheet retain private profiles at ${width}px`,async({page},info)=>{
    await page.setViewportSize({width,height:900});
    const reads:URL[]=[];
    page.on('request',request=>{const url=new URL(request.url());if(url.pathname===`/api/books/${book}/reviews`&&request.method()==='GET')reads.push(url);});
    await page.goto(`${base}/book/${book}`);
    const panel=page.locator('#reviews-panel');
    await expect(panel.locator('.book-review')).toHaveCount(2);
    expect(reads).toHaveLength(1);expect(reads[0].searchParams.get('limit')).toBe('2');
    const clamp=await panel.locator('.book-review-content').evaluateAll(nodes=>nodes.map(el=>({lines:getComputedStyle(el).webkitLineClamp,height:el.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(el).lineHeight)})));
    for(const row of clamp){expect(row.lines).toBe('2');expect(row.height).toBeLessThanOrEqual(row.lineHeight*2+1);}
    const action=panel.getByRole('button',{name:'查看全部评论',exact:true});
    await expect(action).toHaveCSS('min-height','22px');
    const geometry=await action.evaluate(el=>{
      const label=el.querySelector('span')!.getBoundingClientRect(),button=el.getBoundingClientRect(),arrow=el.querySelector('svg')!.getBoundingClientRect();
      return {center:Math.abs(label.x+label.width/2-button.x-button.width/2),gap:arrow.x-label.right};
    });
    expect(geometry.center).toBeLessThan(1);expect(geometry.gap).toBeCloseTo(3.25,1);
    await page.locator('#reviews-section').scrollIntoViewIfNeeded();
    await page.locator('#reviews-section').screenshot({path:info.outputPath(`verified-preview-${width}.png`)});
    await panel.getByRole('button',{name:'查看全部评论',exact:true}).click();
    const sheet=page.getByRole('dialog',{name:'全部评论'});
    await expect(sheet.locator('.book-review')).toHaveCount(5);
    expect(reads).toHaveLength(2);expect(reads[1].searchParams.get('limit')).toBe('3');expect(reads[1].searchParams.get('cursor')).toBeTruthy();
    await expect(sheet).toHaveCSS('height','855px');
    await expect(sheet).toHaveCSS('border-top-left-radius','28px');
    await expect.poll(async()=>Math.round((await sheet.boundingBox())?.y ?? -1)).toBe(45);
    expect((await sheet.locator('.book-review-sheet-header').boundingBox())!.height).toBeLessThanOrEqual(49);
    await expect(sheet.locator('.book-review-sheet-header p')).toHaveCount(0);
    await expect(sheet.locator('.book-review-test-notice')).toHaveCount(0);
    await expect(sheet.getByText('站外摘录',{exact:true})).toHaveCount(0);
    await expect(sheet.getByRole('button',{name:'写书评',exact:true})).toHaveCount(0);
    await expect(sheet.locator('.book-review-composer')).toBeVisible();
    expect(await page.evaluate(()=>document.body.style.overflow)).toBe('hidden');
    await page.screenshot({path:info.outputPath(`verified-sheet-${width}.png`)});
    const scroller=sheet.locator('.book-review-sheet-body');
    while(await sheet.locator('.book-review').count()<total){
      const before=await sheet.locator('.book-review').count();
      if(await scroller.evaluate(el=>el.scrollHeight>el.clientHeight))await scroller.evaluate(el=>el.scrollTop=el.scrollHeight);
      else await sheet.getByRole('button',{name:'加载更多评论',exact:true}).click();
      await expect.poll(()=>sheet.locator('.book-review').count()).toBeGreaterThan(before);
    }
    await expect(sheet.locator('.book-review')).toHaveCount(total);
    await expect(sheet.getByText('已折叠无效评论',{exact:true})).toBeVisible();
    await expect(sheet.locator('.book-review-attribution')).toHaveCount(0);
    await expect(sheet.locator('.book-review-meta')).not.toContainText(['（测试）','测试导入']);
    await expect(sheet.locator('.book-review-stars')).toHaveCount(total);
    const colors=await sheet.locator('.user-avatar').evaluateAll(nodes=>nodes.map(el=>el.getAttribute('data-avatar-color')));
    expect(new Set(colors).size).toBeGreaterThan(2);
    for(const read of reads.slice(2))expect(read.searchParams.get('limit')).toBe('5');
    expect(await sheet.locator('.book-review-content').first().evaluate(el=>getComputedStyle(el).webkitLineClamp)).not.toBe('2');
    await page.keyboard.press('Escape');await expect(sheet).toHaveCount(0);
    await expect(panel.getByRole('button',{name:'查看全部评论',exact:true})).toBeFocused();
    expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
    await panel.getByRole('button',{name:'查看全部评论',exact:true}).click();
    const link=sheet.locator('.book-review-profile-link').first(),href=await link.getAttribute('href');
    await link.click();await expect(page).toHaveURL(base+href);
    await expect(page.locator('.public-profile-role')).toHaveText('测试账号');
    await expect(page.getByRole('heading',{name:'评论来源'})).toBeVisible();
    await expect(page.getByText('星级用于功能测试，非原作者评分；参考改写的内容也不代表原作者原话。')).toBeVisible();
    await expect(page.locator('.public-profile-page')).not.toContainText('邮箱');
    expect(await (await page.request.get(base+href)).text()).not.toContain('@review-test.invalid');
    await page.getByRole('button',{name:'返回',exact:true}).click();await expect(page).toHaveURL(`${base}/book/${book}`);
    if(await sheet.isVisible())await sheet.getByRole('button',{name:'关闭全部评论'}).click();
    expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
  });
}
