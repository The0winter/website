import {test,expect} from './fixtures/without-analytics';

const base=process.env.REVIEW_TEST_BASE||'http://127.0.0.1:3157',book=process.env.REVIEW_TEST_BOOK||'000000000000000000000101';
for(const width of [390,1440])test(`comment dismissal animates every exit and restores focus at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto(`${base}/book/${book}`);
  const opener=page.getByRole('button',{name:'查看全部评论',exact:true});
  await expect(opener).toHaveCSS('border-top-width','0px');
  for(const action of ['button','backdrop','escape']){
    await opener.click();
    const sheet=page.getByRole('dialog',{name:'全部评论'});
    await expect.poll(async()=>Math.round((await sheet.boundingBox())!.y)).toBe(45);
    // Observe actual rendered frames, including scroll locking during the full exit.
    const frames=sheet.evaluate(el=>new Promise<{y:number;locked:boolean}[]>(resolve=>{
      const samples:{y:number;locked:boolean}[]=[];
      function sample(){
        if(!el.isConnected){resolve(samples);return;}
        if(el.hasAttribute('data-closing'))samples.push({y:el.getBoundingClientRect().y,locked:document.body.style.overflow==='hidden'});
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    }));
    if(action==='button')await sheet.getByRole('button',{name:'关闭全部评论'}).click();
    else if(action==='backdrop')await page.mouse.click(width/2,12);
    else {await page.keyboard.press('Escape');await page.keyboard.press('Escape');}
    await expect(sheet).toHaveCount(0);
    const samples=await frames;
    expect(samples.length).toBeGreaterThan(2);
    expect(samples.some(row=>row.y>80&&row.y<850)).toBe(true);
    expect(samples.every(row=>row.locked)).toBe(true);
    expect(samples.at(-1)!.y).toBeGreaterThan(samples[0].y+200);
    await expect(opener).toBeFocused();
    expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await opener.click();
  const sheet=page.getByRole('dialog',{name:'全部评论'});
  await expect(sheet).toHaveCSS('animation-name','none');
  await sheet.getByRole('button',{name:'关闭全部评论'}).click();
  await expect(sheet).toHaveCount(0);await expect(opener).toBeFocused();
});
