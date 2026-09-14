import { test, expect, type Page } from '@playwright/test';

const base = process.env.MANUSCRIPT_BASE_URL || 'http://127.0.0.1:3000';
async function login(page: Page) {
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  page.on('dialog', dialog => dialog.accept());
  if (process.env.MANUSCRIPT_BASE_URL) {
    const csrf=await(await page.request.get(base+'/api/auth/csrf')).json();
    const response=await page.request.post(base+'/api/auth/signin',{headers:{origin:base,'x-csrf-token':csrf.csrfToken},data:{email:'manuscript@example.test',password:'Manuscript-test-123'}});
    expect(response.ok()).toBe(true); return;
  }
  await page.goto(`${base}/login`);
  await page.getByPlaceholder('请输入用户名').fill('隔离作者');
  await page.getByPlaceholder('请输入密码').fill('Local-test-12345');
  await page.getByRole('button', { name: '立即登录' }).click();
  await expect(page).toHaveURL(`${base}/`);
}

async function createPublished(page: Page) {
  await login(page);
  const title = `创作闭环${Date.now().toString().slice(-8)}`;
  await page.goto(`${base}/writer?action=new`);
  await page.getByLabel('书名', {exact:true}).fill(title);
  await page.getByLabel('简介', {exact:true}).fill('仅用于隔离浏览器回归的合成作品。');
  await page.getByRole('button', {name:'创建',exact:true}).click();
  await expect(page).toHaveURL(`${base}/writer`);
  await page.locator('.writer-work').filter({hasText:title}).getByRole('button', {name:'创作',exact:true}).click();
  await page.getByRole('button', {name:'新建章节',exact:true}).click();
  await page.getByLabel('章节名', {exact:true}).fill('第一章 浏览器发布');
  await page.getByLabel('正文', {exact:true}).fill('这是一段经过浏览器发布的合成正文。');
  const published = page.waitForResponse(r => r.url().includes('/workspace/') && r.url().endsWith('/publish') && r.request().method() === 'POST');
  await page.getByRole('button', {name:'发布',exact:true}).click();
  const response = await published; expect(response.ok()).toBe(true);
  await expect(page.locator('.writing-editor')).toHaveCount(0);
  return response.json() as Promise<{bookId:string;chapterId:string}>;
}

test('writer creates a book, publishes and edits a chapter that readers can open', async ({page}) => {
  const {bookId,chapterId} = await createPublished(page);
  await page.locator('.writing-chapter').click();
  await expect(page.getByLabel('正文', {exact:true})).toHaveValue('这是一段经过浏览器发布的合成正文。');
  await page.getByLabel('正文', {exact:true}).fill('这是编辑保存后的合成正文，旧章节 URL 应当继续有效。');
  const edited=page.waitForResponse(r=>r.url().includes('/workspace/') && r.url().endsWith('/publish') && r.request().method()==='POST');
  await page.getByRole('button',{name:'发布',exact:true}).click();
  const response=await edited; expect(response.ok()).toBe(true);
  expect((await response.json()).chapterId).toBe(chapterId);
  await expect(page.locator('.writing-editor')).toHaveCount(0);
  await page.goto(`${base}/book/${bookId}/${chapterId}`);
  await expect(page.getByRole('region',{name:'章节阅读',exact:true}).getByText('这是编辑保存后的合成正文，旧章节 URL 应当继续有效。',{exact:true})).toBeVisible();
});

test('forum question, answer and deep link retain the submitted content', async ({ page }) => {
  await login(page);
  const title = `隔离论坛闭环 ${Date.now()}？`;
  await page.goto(`${base}/forum/create`);
  await page.getByPlaceholder('请输入问题标题（建议以问号结尾）').fill(title);
  await page.getByPlaceholder('问题背景或描述...').fill('用于检验真实浏览器提交和详情展示的合成问题。');
  await page.getByRole('button', { name: '发布', exact: true }).click();
  const created = page.waitForResponse(r => r.url().endsWith('/api/forum/posts') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '确认发布', exact: true }).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  const post = await response.json();
  await expect(page).toHaveURL(`${base}/forum`);
  await page.getByRole('link', { name: title, exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/forum/question/${post.id || post._id}$`));
  await page.getByRole('button', { name: '写回答', exact: true }).click();
  const answerText = '这是浏览器提交的合成回答，刷新和深链接后应继续显示。';
  await page.getByPlaceholder('开始写你的回答...（Ctrl + Enter 快速发布）').fill(answerText);
  await page.getByRole('button', { name: '发布回答', exact: true }).click();
  await expect(page.getByText(answerText, { exact: true })).toBeVisible();
  await expect(page.getByText('1 个回答', { exact: true })).toBeVisible();
  await page.getByText(answerText, { exact: true }).click();
  await expect(page).toHaveURL(/\/forum\/[a-f0-9]{24}\?fromQuestion=/);
  await page.reload();
  await expect(page.getByText(answerText, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '点赞回答', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消点赞回答', exact: true })).toContainText('1');
  await page.reload();
  await expect(page.getByRole('button', { name: '取消点赞回答', exact: true })).toContainText('1');
  await page.getByRole('button', { name: '打开评论', exact: true }).click();
  await page.getByPlaceholder('写下你的评论...').fill('隔离一级评论');
  await page.getByRole('button', { name: '发布评论', exact: true }).click();
  await expect(page.getByText('隔离一级评论', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '回复', exact: true }).click();
  await page.getByPlaceholder('回复 隔离作者...').fill('隔离二级评论');
  await page.getByRole('button', { name: '发布评论', exact: true }).click();
  await expect(page.getByText('隔离二级评论', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '打开评论', exact: true }).click();
  await expect(page.getByText('隔离一级评论', { exact: true })).toBeVisible();
  await expect(page.getByText('隔离二级评论', { exact: true })).toBeVisible();
});

test('saved edit drafts survive refresh while public chapter bytes stay unchanged', async ({page}) => {
  const {bookId,chapterId}=await createPublished(page);
  const chapterUrl=`${base}/api/chapters/${chapterId}`;
  const original=await(await page.request.get(chapterUrl)).json();
  await page.locator('.writing-chapter').click();
  await expect(page.getByLabel('正文',{exact:true})).toHaveValue(original.content);
  const privateText=`尚未公开的编辑草稿 ${Date.now()}`;
  await page.getByLabel('正文',{exact:true}).fill(privateText);
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.locator('.writing-save-state')).toContainText('已保存到本机');
  expect((await(await page.request.get(chapterUrl)).json()).content).toBe(original.content);
  await page.goto(`${base}/writer?action=chapters&work=b_${bookId}`);
  await page.locator('.writing-chapter').click();
  await expect(page.getByLabel('正文',{exact:true})).toHaveValue(privateText);
  await page.reload();
  await expect(page.getByLabel('正文',{exact:true})).toHaveValue(privateText);
  expect((await(await page.request.get(chapterUrl)).json()).content).toBe(original.content);
});

test('bookmarks and ratings persist through the public detail and personal shelf',async({page})=>{
  await login(page);
  await page.goto(`${base}/book/000000000000000000000101`);
  await page.getByRole('button',{name:'加入书架',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'已在书架',exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:/^(写书评|修改)$/}).first().click();
  await page.getByRole('button',{name:'10 分（5 星）',exact:true}).click();
  const review=`浏览器评分与书架回归 ${Date.now()}`;
  await page.getByPlaceholder('写下你的短评...').fill(review);
  const saved=page.waitForResponse(r=>r.url().endsWith('/reviews')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'发表评论',exact:true}).click();
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await expect(page.getByText(review,{exact:true}).first()).toBeVisible();
  await expect(page.getByRole('button',{name:'已在书架',exact:true}).first()).toBeVisible();
  await page.goto(`${base}/library`);
  await expect(page.getByRole('heading',{name:'隔离测试：山海行记',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'移出书架',exact:true}).click();
  await page.getByRole('button',{name:'确认移出',exact:true}).click();
  await expect(page.getByText('书架是空的',{exact:true})).toBeVisible();
});
