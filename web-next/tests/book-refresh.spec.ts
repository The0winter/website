import fs from 'node:fs/promises';
import {test,expect} from './fixtures/without-analytics';

const base=process.env.REVIEW_TEST_BASE||'http://127.0.0.1:3157',book=process.env.REVIEW_TEST_BOOK||'000000000000000000000101';
// An isolated fixture can hold server-side statistics while the real Next shell streams.
const gate=process.env.REVIEW_LOADING_GATE;
for(const width of [320,390,1440])test(`book first paint and refresh keep the correct navigation at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  await page.addInitScript(()=>{
    const state={visibleMobileNavFrames:0,frames:0};
    Object.assign(window,{bookRefreshFrames:state});
    function sample(){
      const nav=document.querySelector('nav[data-site-chrome]');
      if(nav&&/^\/book\/[^/]+\/?$/.test(location.pathname)){
        state.frames++;
        if(innerWidth<768&&nav.getBoundingClientRect().height>0)state.visibleMobileNavFrames++;
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  for(const refresh of [false,true]){
    try{
      if(gate)await fs.writeFile(gate,'hold');
      if(refresh)await page.reload({waitUntil:'commit'});
      else await page.goto(`${base}/book/${book}`,{waitUntil:'commit'});
      if(gate){
        const loading=page.locator('.book-loading');
        await expect(loading).toBeVisible();
        if(width<768){
          await expect(page.locator('nav[data-site-chrome]')).toBeHidden();
          expect((await loading.boundingBox())!.y).toBe(0);
          expect((await loading.locator('.book-loading-cover').boundingBox())!.y).toBe(56);
        }else await expect(page.locator('nav[data-site-chrome]')).toBeVisible();
        await page.screenshot({path:info.outputPath(`verified-${refresh?'refresh':'entry'}-loading-${width}.png`)});
      }
    }finally{if(gate)await fs.rm(gate,{force:true});}
    await expect(page.locator('.book-loading')).toHaveCount(0);
    // Streaming and navigation snapshots can briefly retain a hidden copy of the detail.
    await expect(page.locator('.book-detail:visible')).toHaveCount(1);
    if(width<768)await expect(page.locator('nav[data-site-chrome]')).toBeHidden();
    else await expect(page.locator('nav[data-site-chrome]')).toBeVisible();
    const frames=await page.evaluate(()=>(window as unknown as {bookRefreshFrames:{frames:number;visibleMobileNavFrames:number}}).bookRefreshFrames);
    expect(frames.frames).toBeGreaterThan(0);expect(frames.visibleMobileNavFrames).toBe(0);
  }
  await page.goto(`${base}/authorsList`);
  await expect(page.locator('nav[data-site-chrome]')).toBeVisible();
});
