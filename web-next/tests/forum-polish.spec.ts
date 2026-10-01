import {test, expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';
const base = process.env.QA_TEST_BASE || 'http://127.0.0.1:3000';
test.use({colorScheme:'light',reducedMotion:'no-preference'});
const source = (author:string) => ({author,title:'来源',url:'https://example.org/essay',license:'CC BY',licenseUrl:'https://example.org/license'});
const answer = (id:string,name:string,question:string,title:string) => ({id:question,entryId:id,title,type:'question',author:'导入账号',comments:4,tags:[],votes:1,isHot:false,topReply:{id,content:`<p>${name}谈论${title}。这是一篇不同作者写的独立回答。</p>`,excerpt:`${name}的回答摘要`,votes:3,comments:0,source:source(name),author:{id:'same-importer',name}}});
const rows = [answer('answer-a','甲作者','question-a','怎样理解书中的人物选择？'),answer('answer-b','乙作者','question-a','怎样理解书中的人物选择？'),answer('answer-c','甲作者','question-b','阅读如何改变日常生活？'),answer('answer-d','丙作者','question-c','夏天有什么适合读的短篇？')];
async function mockFeed(page:Page) {
  await page.route('**/api/forum/posts?*', route => route.fulfill({json:rows}));
  await page.route('**/api/forum/posts/*/views', route => route.fulfill({json:{counted:false}}));
}
const entries = (page:Page) => page.locator('.forum-feed-panel[aria-hidden=false] .forum-entry');
async function openFeedback(page:Page) {
  await entries(page).first().getByRole('button',{name:/不感兴趣/}).click();
  const dialog = page.getByRole('dialog',{name:'调整推荐'});
  await expect(dialog).toBeVisible();
  return dialog;
}
for (const width of [320,390,1440]) {
  test(`${width}px feedback sheet filters only the selected source author and persists with undo`,async ({page},info) => {
    await page.setViewportSize({width,height:844}); await mockFeed(page); await page.goto(base+'/forum');
    await expect(entries(page)).toHaveCount(4);
    await expect(page.locator('.forum-feed-panel[aria-hidden=false]').getByText('阅读全文')).toHaveCount(0);
    const dialog = await openFeedback(page);
    await expect(dialog.locator('.forum-feedback-options button')).toHaveCount(5);
    await expect(dialog).not.toContainText('设置屏蔽关键词'); await expect(dialog).not.toContainText('举报');
    await expect(dialog).toHaveCSS('animation-duration','0.4s');
    await expect.poll(async () => dialog.evaluate(node => node.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({path:info.outputPath(`verified-feedback-${width}.png`)});
    await dialog.getByRole('button',{name:'不再推荐作者：甲作者'}).click();
    await expect(dialog).toHaveCount(0); await expect(entries(page)).toHaveCount(2);
    await expect(entries(page).first()).toContainText('乙作者'); await expect(entries(page).last()).toContainText('丙作者');
    await page.reload(); await expect(entries(page)).toHaveCount(2);
    await page.getByRole('button',{name:/推荐偏好/}).click();
    await page.getByRole('button',{name:'恢复推荐'}).click();
    await page.getByRole('button',{name:'关闭弹窗'}).click();
    await expect(entries(page)).toHaveCount(4);
    const next = await openFeedback(page); await next.getByRole('button',{name:'不喜欢该内容'}).click();
    await expect(entries(page)).toHaveCount(3); await page.getByRole('button',{name:'撤销',exact:true}).click();
    await expect(entries(page)).toHaveCount(4);
  });
}
test('repeated questions, poor quality and extreme content have durable, reversible effects',async ({page}) => {
  await page.setViewportSize({width:390,height:844}); await mockFeed(page); await page.goto(base+'/forum');
  await expect(entries(page)).toHaveCount(4);
  await (await openFeedback(page)).getByRole('button',{name:'太多重复或相似内容'}).click();
  await expect(entries(page)).toHaveCount(2);
  await page.reload(); await expect(entries(page)).toHaveCount(2);
  await page.getByRole('button',{name:/推荐偏好/}).click(); await page.getByRole('button',{name:'恢复推荐'}).click(); await page.getByRole('button',{name:'关闭弹窗'}).click();
  for (const reason of ['内容极端或引战','内容质量差']) {
    await (await openFeedback(page)).getByRole('button',{name:reason,exact:true}).click();
    await expect(entries(page)).toHaveCount(3);
    await page.reload(); await expect(entries(page)).toHaveCount(3);
    await page.getByRole('button',{name:/推荐偏好/}).click();
    await expect(page.getByRole('dialog')).toContainText(reason);
    await page.getByRole('button',{name:'恢复推荐'}).click(); await page.getByRole('button',{name:'关闭弹窗'}).click();
    await expect(entries(page)).toHaveCount(4);
  }
});
test('entering forum keeps the navigation white even while the route is delayed',async ({page},info) => {
  await page.setViewportSize({width:390,height:844}); await mockFeed(page);
  let release!:()=>void; const held = new Promise<void>(resolve => {release=resolve;});
  await page.route('**/forum?_rsc=*', async route => {await held; await route.continue();});
  await page.goto(base);
  try {
    await page.locator('.mh-bottom:visible [data-section=forum]').click();
    await expect(page.locator('.mobile-section-header')).toBeVisible();
    await expect(page.locator('.mobile-section-header')).toHaveCSS('background-color','rgb(255, 255, 255)');
    // The navigation snapshot must survive even after the 400ms slide ends.
    await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition','loading');
    await expect(page.locator('.mobile-section-header')).toBeVisible();
    await expect(page.locator('.mobile-section-header')).toHaveCSS('background-color','rgb(255, 255, 255)');
    await page.screenshot({path:info.outputPath('verified-pending-white-header.png')});
  } finally {release();}
  await expect(page.locator('.forum-page > .forum-masthead')).toBeVisible();
  await expect(page.locator('.forum-masthead .mh-topbar')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(page.locator('.forum-feed-track')).toHaveCSS('transition-duration','0.4s');
});
test('answer count, divider, curved share icons and reduced motion',async ({page},info) => {
  await page.setViewportSize({width:390,height:844});
  const feed = await (await page.request.get(base+'/api/forum/posts?view=answers')).json();
  const qid = feed.find((row:{type:string}) => row.type === 'question').id;
  await page.route('**/api/forum/posts/'+qid,route=>route.fulfill({json:{...rows[0],id:qid}}));
  await page.route(`**/api/forum/posts/${qid}/replies?*`,route=>route.fulfill({json:rows.map((row,i)=>({...row.topReply,time:'2026-09-30T00:00:00Z',content:`<p>${'完整回答的文字。'.repeat(80)}</p>`,author:{...row.topReply.author,bio:'',avatar:''},id:'answer-'+i}))}));
  await page.route('**/api/forum/posts/*/views',route=>route.fulfill({json:{counted:false}}));
  await page.goto(base+'/forum/question/'+qid);
  await expect(page.locator('.qa-answer-count')).toHaveText('4 个回答');
  await expect(page.locator('.qa-question')).toHaveCSS('border-bottom-width','1px');
  await expect(page.getByRole('button',{name:'分享当前回答'}).locator('svg')).toHaveAttribute('data-share-arrow','curved');
  await page.screenshot({path:info.outputPath('verified-answer-count.png')});
  await page.locator('.qa-actionbar .qa-current-author').click();
  await expect(page.getByRole('dialog')).toHaveCSS('animation-duration','0.4s');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('.qa-actionbar .qa-current-author').click();
  await expect(page.getByRole('dialog')).toHaveCSS('animation-name','none');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});
