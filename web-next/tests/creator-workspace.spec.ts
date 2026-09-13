import {test, expect, type Page} from '@playwright/test';
const base = process.env.MANUSCRIPT_BASE_URL || 'http://127.0.0.1:3107';
async function login(page: Page) {
  const csrf = await (await page.request.get(base + '/api/auth/csrf')).json();
  const response = await page.request.post(base + '/api/auth/signin', {headers:{origin:base,'x-csrf-token':csrf.csrfToken},data:{email:'manuscript@example.test',password:'Manuscript-test-123'}});
  expect(response.ok()).toBeTruthy();
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent='nextjs-portal{display:none!important}'; document.head.append(style);}));
}
test.beforeEach(async ({page}) => login(page));
for (const width of [320,390,1440]) test(`creation, private list, unnamed publication and work management at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  const title=`新故事${width}${Date.now().toString().slice(-5)}`;
  await page.goto(base+'/writer?action=new');
  await page.getByLabel('书名',{exact:true}).fill(title);
  await page.getByLabel('简介',{exact:true}).fill('这是一部关于旅途的故事。');
  if(width===1440) {
    await expect(page.locator('.manuscript-form')).not.toHaveAttribute('role','dialog');
    expect((await page.locator('.manuscript-form').boundingBox())!.width).toBeGreaterThan(1200);
    await expect(page.getByLabel('书名',{exact:true})).toHaveCSS('font-size','17px');
    const details=await page.locator('.manuscript-details').boundingBox(), source=await page.locator('.manuscript-import').boundingBox();
    expect(Math.abs(details!.y-source!.y)).toBeLessThan(2);
    expect(source!.x).toBeGreaterThan(details!.x+details!.width);
  }
  await page.screenshot({path:info.outputPath('create.png'),fullPage:true});
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  const work=page.locator('.writer-work').filter({hasText:title});
  await expect(work.locator('.work-private')).toBeVisible();
  await expect(page).toHaveURL(base+'/writer');
  await page.reload();
  await work.getByRole('button',{name:'继续创作',exact:true}).click();
  await expect(page.getByLabel('书名',{exact:true})).toHaveValue(title);
  await page.locator('input[type=file][accept*=".txt"]').setInputFiles({name:'story.txt',mimeType:'text/plain',buffer:Buffer.from('第一章\n清晨的风穿过山林。\n第二章\n她在河边收到来信。')});
  await page.getByRole('button',{name:'识别并预览',exact:true}).click();
  await page.getByRole('button',{name:'修正本章',exact:true}).click();
  await page.getByLabel('章节标题',{exact:true}).fill('');
  await page.getByRole('button',{name:'查看阅读效果',exact:true}).click();
  await expect(page.locator('.manuscript-preview h4')).toHaveText('第1章');
  await expect(page.locator('.manuscript-error')).toHaveCount(0);
  await page.getByRole('checkbox').check();
  await expect(page.getByRole('button',{name:'提交作品',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'提交作品',exact:true}).click();
  await expect(work).toBeVisible();
  await expect(work.locator('.work-private')).toHaveCount(0);
  await work.getByLabel(`管理《${title}》`,{exact:true}).click();
  await work.getByRole('button',{name:'转为私密',exact:true}).click();
  await expect(work.locator('.work-private')).toBeVisible();
  await work.getByRole('button',{name:'继续创作',exact:true}).click();
  await expect(page.getByRole('button',{name:'公开作品',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'公开作品',exact:true}).click();
  await expect(page.getByRole('button',{name:'公开作品',exact:true})).toHaveCount(0);
});

for(const width of [320,390]) test(`mobile center, statistics and private draft resume at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:844});
  await page.goto(base);
  await page.getByRole('button',{name:'创作',exact:true}).click();
  const center=page.getByRole('dialog',{name:'创作中心',exact:true});
  await expect(center.getByRole('link',{name:'作品数据'})).toBeVisible();
  await expect(center.getByRole('link',{name:'写一章'})).toHaveCount(0);
  await center.getByRole('link',{name:'新建作品'}).click();
  const title=`手机草稿${width}${Date.now().toString().slice(-4)}`;
  await page.getByLabel('书名',{exact:true}).fill(title);
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.locator('.mw-view')).toHaveCount(0);
  const card=center.locator('.mw-book').filter({hasText:title});
  await expect(card).toContainText('私密');
  const infoBox=await card.locator('.mw-book-info').boundingBox(), actions=await card.locator('.mw-book-actions').boundingBox();
  expect(actions!.x).toBeGreaterThan(infoBox!.x);
  expect(await center.evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('my-works.png')});
  await card.getByRole('link',{name:'继续创作',exact:true}).click();
  await expect(page.getByLabel('书名',{exact:true})).toHaveValue(title);
  await page.getByLabel('关闭新建作品',{exact:true}).click();
  await expect(page.locator('.mw-view')).toHaveCount(0);
  await center.getByRole('link',{name:'作品数据'}).click();
  await expect(page.locator('.ws-cards')).toBeVisible();
  for(const label of ['每周','每月','每日']) {
    await page.getByRole('button',{name:label,exact:true}).click();
    await expect(page.locator('.writer-statistics')).toHaveAttribute('aria-busy','false');
    await expect(page.getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-pressed','true');
  }
  const chart=page.getByRole('region',{name:'浏览量时间图，可左右滑动'});
  expect(await chart.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
  await chart.evaluate(el=>el.scrollLeft=0);
  expect(await chart.evaluate(el=>el.scrollLeft)).toBe(0);
  await page.screenshot({path:info.outputPath('statistics.png')});
  await page.getByRole('button',{name:'返回创作中心',exact:true}).click();
  await expect(page.locator('.mw-view')).toHaveCount(0);
  await card.getByLabel(`管理《${title}》`).click();
  await expect(card.getByRole('button',{name:'已为私密'})).toBeDisabled();
  page.once('dialog',dialog=>dialog.accept());
  await card.getByRole('button',{name:'删除作品'}).click();
  await expect(card).toHaveCount(0);
});
