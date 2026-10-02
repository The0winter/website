import fs from 'node:fs';
import {test, expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';

const base = 'http://127.0.0.1:3000';
const fixturePath = process.env.FORUM_FIXTURE_FILE;
const manifest = fixturePath ? JSON.parse(fs.readFileSync(fixturePath, 'utf8')) : null;
test.skip(!manifest, 'Run dev:isolated with FORUM_FIXTURE_FILE pointing at a local licensed article manifest.');
test.use({colorScheme:'light'});

async function entries(page:Page) {
  const response = await page.request.get(base + '/api/forum/posts?view=answers');
  expect(response.ok()).toBeTruthy();
  const feed = await response.json();
  const rows = feed.filter((row:{title:string}) => row.title === manifest.question.title);
  expect(rows).toHaveLength(5);
  return rows as Array<{id:string;entryId:string;bookId:string;topReply:{id:string;title:string;source:{url:string}}}>;
}

for (const width of [390,1440]) {
  test(`${width}px: five full reviews share a question and book, with a white discussion surface`, async ({page}, info) => {
    await page.setViewportSize({width,height:900});
    const errors:string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const rows = await entries(page), first = rows[0];
    await page.goto(base + '/forum');
    const panel = page.locator('.forum-feed-panel[aria-hidden=false]');
    await expect(panel.locator('.forum-entry')).toHaveCount(5);
    await expect(panel.locator('.forum-entry-list')).toHaveCSS('background-color','rgb(255, 255, 255)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({path:info.outputPath(`final-forum-${width}.png`)});
    await panel.locator('.forum-entry-title').first().click();
    await expect(page).toHaveURL(new RegExp(`/forum/${first.entryId}\\?fromQuestion=${first.id}`));
    await expect(page.locator('.qa-question h1')).toHaveText(manifest.question.title);
    await expect(page.locator('.qa-answer')).toHaveCount(5);
    await expect(page.locator('.qa-answer > h2')).toHaveCount(0);
    const source = page.getByRole('complementary',{name:'文章来源与许可'}).first();
    await expect(source.getByRole('link',{name:'查看原文 ↗'})).toHaveAttribute('href',first.topReply.source.url);
    await expect(page.locator('.qa-body').first()).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(first.topReply.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({path:info.outputPath(`final-answer-${width}.png`)});
    await page.locator('.qa-actionbar .qa-current-author').click();
    await expect(page.getByRole('dialog',{name:'全部 5 个回答'})).toBeVisible();
    await expect(page.locator('.qa-directory-item')).toHaveCount(5);
    await page.screenshot({path:info.outputPath(`final-question-${width}.png`)});
    await page.getByRole('dialog').getByRole('link',{name:'查看相关书籍'}).click();
    await expect(page.getByRole('region',{name:'文章',exact:true})).toBeVisible();
    await expect(page.locator('#articles-section .forum-entry')).toHaveCount(5);
    await expect(page.locator('#articles-section')).toHaveCSS('background-color','rgb(255, 255, 255)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.locator('#articles-section').scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath(`final-book-discussions-${width}.png`)});
    await page.locator('#articles-section .forum-entry-title').first().click();
    await expect(page.locator('.qa-question h1')).toHaveText(manifest.question.title);
    expect(errors).toEqual([]);
  });
}

test('all five rendered bodies preserve the collected text and source attribution', async ({page}) => {
  const rows = await entries(page);
  for (const row of rows) {
    const expected = manifest.articles.find((article:{source:{url:string}}) => article.source.url === row.topReply.source.url);
    const response = await page.request.get(`${base}/api/forum/posts/${row.id}/replies?target=${row.entryId}`);
    const [answer] = await response.json();
    expect(answer.content).toBe(expected.content);
    expect(answer.source.author).toBe(expected.source.author);
    await page.goto(`${base}/forum/${row.entryId}?fromQuestion=${row.id}`);
    await expect(page.locator('.qa-body').first()).toBeVisible();
    const rendered = await page.locator('.qa-body').first().textContent();
    const original = await page.evaluate(html => new DOMParser().parseFromString(html,'text/html').body.textContent, expected.content);
    expect(rendered?.replace(/\s/g,'')).toBe(original?.replace(/\s/g,''));
    await expect(page.locator('.qa-answer').first().getByRole('link',{name:expected.source.license,exact:true})).toHaveAttribute('href',expected.source.licenseUrl);
  }
});

test('a reader can like, comment, reply, and revisit the same answer', async ({page}, info) => {
  await page.setViewportSize({width:390,height:844});
  const [row] = await entries(page);
  const csrf = await (await page.request.get(base + '/api/auth/csrf')).json();
  const login = await page.request.post(base + '/api/auth/signin', {headers:{origin:base,'x-csrf-token':csrf.csrfToken},data:{email:'reader@example.test',password:'Local-test-12345'}});
  expect(login.ok()).toBeTruthy();
  await page.goto(`${base}/forum/${row.entryId}?fromQuestion=${row.id}`);
  const like = page.getByRole('button',{name:'赞同当前回答',exact:true});
  await like.click();
  await expect(page.getByRole('button',{name:'取消赞同当前回答',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'打开当前回答评论',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'回答评论'});
  await expect(dialog).toBeVisible();
  const comment = `完整阅读后的本地测试评论 ${Date.now()}`;
  await dialog.getByRole('textbox',{name:'评论内容'}).fill(comment);
  await dialog.getByRole('button',{name:'发布评论',exact:true}).click();
  await expect(dialog.getByText(comment,{exact:true})).toBeVisible();
  await dialog.locator('.qa-comment').filter({has:page.getByText(comment,{exact:true})}).getByRole('button',{name:'回复',exact:true}).click();
  const child = '二级回复：也想聊聊这个观点。' + Date.now();
  await dialog.getByRole('textbox',{name:'评论内容'}).fill(child);
  await dialog.getByRole('button',{name:'发布评论',exact:true}).click();
  await expect(dialog.getByText(child,{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('final-answer-comments-mobile.png')});
  await dialog.getByRole('button',{name:'关闭弹窗'}).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button',{name:'取消赞同当前回答',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'打开当前回答评论',exact:true}).click();
  await expect(dialog.getByText(comment,{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'关闭弹窗'}).click();
  await page.getByRole('button',{name:'取消赞同当前回答',exact:true}).click();
  await expect(page.getByRole('button',{name:'赞同当前回答',exact:true})).toBeVisible();
});

test('discussion styles stay scoped after client navigation, including dark mode', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto(base + '/');
  const original = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--home-background'));
  await page.goto(base + '/forum');
  await expect(page.locator('.forum-entry').first()).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--home-background'))).toBe(original);
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('.forum-entry-list').first()).toHaveCSS('background-color','rgb(28, 32, 38)');
  await page.emulateMedia({colorScheme:'light'});
  await page.getByRole('navigation',{name:'移动端主导航'}).getByRole('link',{name:'精选',exact:true}).click();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--home-background'))).toBe(original);
});

test('publish a book question, answer it, and keep standalone article comments working', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  const [row] = await entries(page);
  const csrf = await (await page.request.get(base + '/api/auth/csrf')).json();
  expect((await page.request.post(base + '/api/auth/signin', {headers:{origin:base,'x-csrf-token':csrf.csrfToken},data:{email:'reader@example.test',password:'Local-test-12345'}})).ok()).toBeTruthy();
  const stamp = Date.now();
  await page.goto(`${base}/forum/create?type=question&bookId=${row.bookId}&bookTitle=${encodeURIComponent('三体')}`);
  await page.getByPlaceholder('请输入问题标题（建议以问号结尾）').fill(`哪些情节值得重读 ${stamp}？`);
  await page.getByPlaceholder('问题背景或描述...').fill('本地验证：与书籍关联的新问题。');
  await page.getByRole('button',{name:'发布',exact:true}).click();
  await page.getByRole('button',{name:'确认发布',exact:true}).click();
  await expect(page).toHaveURL(/\/forum\/question\/[a-f0-9]{24}$/);
  await expect(page.locator('.fq-heading h1')).toHaveText(`哪些情节值得重读 ${stamp}？`);
  await page.locator('.fq-actions').getByRole('button',{name:'写回答',exact:true}).click();
  await page.getByRole('textbox',{name:'回答内容'}).fill('我的回答包含 <普通文字>，换行后继续。\n这是第二段。');
  await page.getByRole('button',{name:'发布回答',exact:true}).click();
  await expect(page.locator('.qa-answer')).toHaveCount(1);
  await expect(page.locator('.qa-body')).toContainText('<普通文字>');
  await expect(page.getByRole('complementary',{name:'文章来源与许可'})).toHaveCount(0);

  await page.goto(`${base}/forum/create?type=article&bookId=${row.bookId}&bookTitle=${encodeURIComponent('三体')}`);
  await page.getByPlaceholder('请输入文章标题').fill(`独立读后感 ${stamp}`);
  await page.getByPlaceholder('开始写正文内容...').fill('独立文章也可以阅读和评论。');
  await page.getByRole('button',{name:'发布',exact:true}).click();
  await page.getByRole('button',{name:'确认发布',exact:true}).click();
  await expect(page).toHaveURL(/\/forum\/[a-f0-9]{24}$/);
  await expect(page.locator('.forum-prose')).toHaveText('独立文章也可以阅读和评论。');
  await page.getByRole('button',{name:'打开评论',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'文章评论'});
  await dialog.getByRole('textbox',{name:'评论内容'}).fill('这条评论属于独立文章。');
  await dialog.getByRole('button',{name:'发布评论',exact:true}).click();
  await expect(dialog.getByText('这条评论属于独立文章。',{exact:true})).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'打开评论',exact:true}).click();
  await expect(dialog.getByText('这条评论属于独立文章。',{exact:true})).toBeVisible();
});
