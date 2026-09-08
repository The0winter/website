import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const base='http://127.0.0.1:3000',book='000000000000000000000101',first='000000000000000000000101';
test('reader has usable server-rendered text and navigation with JavaScript disabled',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const page=await context.newPage();
  try{
    expect((await page.goto(`${base}/book/${book}/${first}`))?.status()).toBe(200);
    await expect(page.getByText('这是用于验证排版与翻页的合成正文。').first()).toBeVisible();
    const nav=page.getByRole('navigation',{name:'无脚本章节导航'});
    await expect(nav.getByRole('link',{name:'下一章'})).toHaveAttribute('href',`/book/${book}/000000000000000000000102`);
    await nav.getByRole('link',{name:'下一章'}).click();
    await expect(page).toHaveURL(`${base}/book/${book}/000000000000000000000102`);
    await expect(page.getByRole('heading',{name:'第2章 山间来信',exact:true})).toBeVisible();
    await page.getByRole('navigation',{name:'无脚本章节导航'}).getByRole('link',{name:'上一章'}).click();
    await expect(page).toHaveURL(`${base}/book/${book}/${first}`);
  }finally{await context.close();}
});
test('sitemap index and chapter file use public legacy paths and missing paths return 404',async({request})=>{
  const index=await request.get(base+'/sitemap.xml');expect(index.status()).toBe(200);
  expect(await index.text()).toContain(`/sitemaps/${book}/1.xml`);
  const chapters=await request.get(`${base}/sitemaps/${book}/1.xml`);expect(chapters.status()).toBe(200);
  expect(await chapters.text()).toContain(`/book/${book}/${first}`);
  expect((await request.get(`${base}/sitemaps/${book}/99999.xml`)).status()).toBe(404);
  expect((await request.get(`${base}/book/${book}/000000000000000000ffffff`)).status()).toBe(404);
});
test('one hundred chapter changes and browser back keep URL and visible content aligned',async({page})=>{
  test.setTimeout(180000);
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.setViewportSize({width:1440,height:900});
  await page.goto(`${base}/book/${book}/${first}`);
  await expect(page.getByRole('button',{name:'下一章',exact:true})).toBeEnabled();
  const samples=[];let previous=1;
  for(let step=1;step<=100;step++){
    const position=step%22,number=position<=11?position+1:23-position;
    const id=(256+number).toString(16).padStart(24,'0');
    await page.keyboard.press(number>previous?'ArrowRight':'ArrowLeft');
    await expect(page).toHaveURL(`${base}/book/${book}/${id}`);
    await expect(page.getByRole('heading',{name:`第${number}章 山间来信`,exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:number===12?'上一章':'下一章',exact:true})).toBeEnabled();
    if(step%10===0)samples.push({step,heap:await page.evaluate(()=>(performance as Performance & {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize||null)});
    previous=number;
  }
  await page.goBack();
  const id=page.url().split('/').pop()!,number=parseInt(id,16)-256;
  await expect(page.getByRole('heading',{name:`第${number}章 山间来信`,exact:true})).toBeVisible();
  await fs.writeFile('artifacts/reader-100-switches.json',JSON.stringify({switches:100,backVerified:true,samples},null,2));
});
