import {test, expect} from '@playwright/test';
import mongoose from 'mongoose';

const base = 'http://127.0.0.1:3000';
const cases = [
  {kind: 'short', description: '一段可以完整显示的简短简介。'},
  {kind: 'four-lines', description: '第一行简介\n第二行简介\n第三行简介\n第四行简介'},
  {kind: 'long', description: '一段关于山林与旅行的小说简介。'.repeat(35)},
  {kind: 'empty', description: ''},
  {kind: 'responsive', description: '这是一个关于山林与旅行的故事，行者沿着山间小路寻找远方的来信。'.repeat(3)},
].map(row => ({...row, id: new mongoose.Types.ObjectId()}));
let database: mongoose.Connection;

test.beforeAll(async () => {
  database = await mongoose.createConnection('mongodb://127.0.0.1:27028/test1_dev?replicaSet=testset', {serverSelectionTimeoutMS: 5000}).asPromise();
  const seed = await database.collection('books').findOne({_id: new mongoose.Types.ObjectId('000000000000000000000101')});
  if (seed?.title !== '隔离测试：山海行记') throw Error('Synthetic development fixture required');
  await database.collection('books').insertMany(cases.map(row => ({_id: row.id, title: `简介验证 ${row.kind}`, description: row.description, author: '测试作者', deletedAt: null, writeVersion: 0})));
});
test.afterAll(async () => {
  if (database) {await database.collection('books').deleteMany({_id: {$in: cases.map(row => row.id)}}); await database.close();}
});
test.beforeEach(async ({page}) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

for (const width of [320, 390, 767]) {
  test(`only genuinely truncated descriptions can expand at ${width}px`, async ({page}, info) => {
    await page.setViewportSize({width, height: 844});
    for (const row of cases.filter(row => row.kind !== 'responsive')) {
      await page.goto(`${base}/book/${row.id}`);
      await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
      const description = page.locator('.book-description:visible');
      await expect(description).toBeVisible();
      await expect(description).toHaveText(row.description || '暂无简介');
      await page.evaluate(() => document.fonts.ready);
      if (row.kind === 'long') {
        await expect(page.getByRole('button', {name: '展开简介'})).toBeVisible();
        const collapsed = await description.evaluate(el => el.clientHeight);
        await page.getByRole('button', {name: '展开简介'}).click();
        await expect(page.getByRole('button', {name: '收起简介'})).toHaveAttribute('aria-expanded', 'true');
        expect(await description.evaluate(el => el.clientHeight)).toBeGreaterThan(collapsed);
        await page.getByRole('button', {name: '收起简介'}).click();
        await expect(page.getByRole('button', {name: '展开简介'})).toHaveAttribute('aria-expanded', 'false');
      } else await expect(page.getByRole('button', {name: /展开简介|收起简介/})).toHaveCount(0);
      await page.screenshot({path: info.outputPath(`${row.kind}.png`)});
    }
  });
}

test('description controls follow available width and remain correct after expanding', async ({page}) => {
  const row = cases.find(row => row.kind === 'responsive')!;
  await page.setViewportSize({width: 320, height: 844});
  await page.goto(`${base}/book/${row.id}`);
  await expect(page.getByRole('button', {name: '展开简介'})).toBeVisible();
  await page.setViewportSize({width: 767, height: 844});
  await expect(page.getByRole('button', {name: /展开简介|收起简介/})).toHaveCount(0);
  await page.setViewportSize({width: 320, height: 844});
  await page.getByRole('button', {name: '展开简介'}).click();
  await page.setViewportSize({width: 767, height: 844});
  await expect(page.getByRole('button', {name: /展开简介|收起简介/})).toHaveCount(0);
  await page.setViewportSize({width: 320, height: 844});
  await expect(page.getByRole('button', {name: '收起简介'})).toBeVisible();
  await page.setViewportSize({width: 1440, height: 900});
  await expect(page.getByRole('button', {name: /展开简介|收起简介/})).toBeHidden();
});
