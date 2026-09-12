import { test, expect, type Page } from '@playwright/test';

const base = process.env.CREATION_BASE_URL || 'http://127.0.0.1:3000';
const account = { id: '000000000000000000000099', username: '清风读者', email: 'preview@example.test', role: 'reader' };
const book = { id: '000000000000000000000199', title: '山海之间：一个尚未写完的故事', description: '从第一笔开始的世界。', author_id: account.id, category: '仙侠', status: 'ongoing' };
const modal = (page: Page) => page.getByRole('dialog', { name: '创作中心', exact: true });
const launch = (page: Page) => page.getByRole('button', { name: '创作', exact: true });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: account, profile: account } }));
  await page.route('**/api/books?**', route => new URL(route.request().url()).searchParams.get('author_id') === account.id ? route.fulfill({ json: [book] }) : route.continue());
  await page.route(`**/api/books/${book.id}/chapters**`, route => route.fulfill({ json: [] }));
  await page.route(`**/api/books/${book.id}/draft`, route => route.fulfill({ json: { id: 'private-draft', title: '第一章 风起', content: '留给自己的未发布草稿。' } }));
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none!important}'; document.head.append(style);
  }));
});

for (const width of [320, 390, 430]) {
  test(`quarter-circle entry and creator workspace fit ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base);
    const entry = await launch(page).boundingBox();
    const bottom = await page.locator('.mh-bottom:visible').boundingBox();
    expect(entry!.x + entry!.width).toBe(width);
    expect(bottom!.y - entry!.y).toBeGreaterThan(12);
    expect(bottom!.y - entry!.y).toBeLessThan(28);
    await expect(launch(page)).toHaveCSS('border-top-left-radius', '76px');
    for (const link of await page.locator('.mh-bottom:visible>a').all()) {
      const box = await link.boundingBox(); expect(box!.width).toBeGreaterThan(44); expect(box!.x + box!.width).toBeLessThanOrEqual(entry!.x);
    }
    await page.screenshot({ path: info.outputPath(`entry-${width}.png`) });
    await launch(page).click(); await expect(modal(page)).toBeVisible();
    await expect(modal(page).getByRole('heading', { name: book.title })).toBeVisible();
    await expect(modal(page)).toHaveAttribute('data-ready', 'true');
    await expect(modal(page)).toHaveCSS('clip-path', 'none');
    expect(await modal(page).evaluate(element => element.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`center-${width}.png`) });
  });
}

test('opening uses a radial reveal and Back/Forward, Escape and focus restore correctly', async ({ page }, info) => {
  await page.goto(base); await page.evaluate(() => scrollTo(0, 180));
  const position = await page.evaluate(() => scrollY);
  const length = await page.evaluate(() => history.length);
  await page.evaluate(() => {
    const capture = (event: AnimationEvent) => {
      if (event.animationName !== 'mw-reveal-in') return;
      const background = event.target as HTMLElement;
      Object.assign(window, { writerRevealFrame: { transform: getComputedStyle(background).transform, clip: getComputedStyle(background.closest('.mw-dialog')!).clipPath, width: background.getBoundingClientRect().width } });
      document.removeEventListener('animationstart', capture);
    };
    document.addEventListener('animationstart', capture);
  });
  await launch(page).click(); await expect(modal(page)).toBeVisible();
  const reveal = await page.evaluate(() => (window as Window & { writerRevealFrame?: { transform: string; clip: string; width: number } }).writerRevealFrame!);
  expect(reveal.transform).toMatch(/^matrix\(/); expect(reveal.clip).toBe('none');
  expect(reveal.width).toBeLessThan(Math.hypot(390, 844));
  await page.screenshot({ path: info.outputPath('radial-opening.png') });
  await modal(page).evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => { if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish(); }));
  expect(await page.evaluate(() => history.length)).toBe(length + 1);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.keyboard.press('Tab');
  expect(await modal(page).evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.goBack(); await expect(modal(page)).toHaveCount(0);
  expect(await page.evaluate(() => scrollY)).toBe(position);
  await expect(launch(page)).toBeFocused();
  await page.goForward(); await expect(modal(page)).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(length + 1);
  await page.keyboard.press('Escape'); await expect(modal(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await launch(page).click(); await expect(modal(page)).toBeVisible();
  await page.getByRole('button', { name: '关闭创作中心' }).click(); await expect(modal(page)).toHaveCount(0);
});

for (const width of [320, 390]) test(`creator actions open the matching creation, editor and draft-management views at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(base); await launch(page).click();
  await modal(page).getByRole('link', { name: /新建作品/ }).click();
  await expect(page.getByPlaceholder('请输入书名')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`create-${width}.png`) });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.goBack(); await launch(page).click();
  await modal(page).getByRole('link', { name: '写一章', exact: true }).click();
  await expect(page.getByPlaceholder('请输入章节标题')).toBeVisible();
  await expect(page.getByRole('button', { name: '存草稿', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`editor-${width}.png`) });
  await page.goBack(); await launch(page).click();
  await modal(page).getByRole('link', { name: '目录与草稿', exact: true }).click();
  await expect(page.getByText('目录与设置', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`manager-${width}.png`) });
  await page.getByRole('button', { name: '继续草稿', exact: true }).click();
  await expect(page.getByPlaceholder('在这里开始你的创作...')).toHaveValue('留给自己的未发布草稿。');
});

test('guest login, failed works retry and reduced motion remain usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: null, profile: null } }));
  await page.goto(base); await launch(page).click();
  await expect(modal(page)).toHaveAttribute('data-ready', 'true');
  await modal(page).getByRole('link', { name: '登录并开始创作' }).click();
  await expect(page.locator('.login-card')).toBeVisible(); await page.goBack();
  await expect(modal(page)).toHaveCount(0);
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: account, profile: account } }));
  let failed = true;
  await page.route('**/api/books?**', route => new URL(route.request().url()).searchParams.get('author_id') === account.id ? route.fulfill(failed ? { status: 503, json: { error: 'test unavailable' } } : { json: [book] }) : route.continue());
  await page.reload(); await launch(page).click();
  await expect(modal(page).getByRole('alert')).toBeVisible(); failed = false;
  await modal(page).getByRole('button', { name: '重新加载' }).click();
  await expect(modal(page).getByRole('heading', { name: book.title })).toBeVisible();
  await page.setViewportSize({ width: 900, height: 844 });
  await expect(modal(page)).toHaveCount(0);
  await expect(launch(page)).toBeHidden();
});

test('fast works responses do not mount the list during the opening animation', async ({ page }) => {
  await page.goto(base);
  await page.evaluate(() => {
    const timing = { contentFinished: 0, listMounted: 0 };
    Object.assign(window, { writerMotionTiming: timing });
    document.addEventListener('animationend', event => { if (event.animationName === 'mw-content-in') timing.contentFinished = performance.now(); });
    const observer = new MutationObserver(() => {
      if (document.querySelector('.mw-book')) { timing.listMounted = performance.now(); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await launch(page).click();
  await expect(modal(page).getByRole('heading', { name: book.title })).toBeVisible();
  const timing = await page.evaluate(() => (window as Window & { writerMotionTiming?: { contentFinished: number; listMounted: number } }).writerMotionTiming!);
  expect(timing.contentFinished).toBeGreaterThan(0);
  expect(timing.listMounted).toBeGreaterThanOrEqual(timing.contentFinished);
});

test('Back during the reveal closes from its current size without flashing full-screen', async ({ page }) => {
  await page.goto(base); await launch(page).click(); await expect(modal(page)).toBeVisible();
  const sizes = await modal(page).evaluate(element => new Promise<{ before: number; after: number }>(resolve => {
    const background = element.querySelector('.mw-reveal')!;
    element.getAnimations({ subtree: true }).forEach(animation => { animation.pause(); animation.currentTime = 40; });
    const before = background.getBoundingClientRect().width;
    window.addEventListener('popstate', () => { resolve({ before, after: background.getBoundingClientRect().width }); }, { once: true });
    history.back();
  }));
  expect(sizes.after).toBeLessThanOrEqual(sizes.before + 2);
  await expect(modal(page)).toHaveCount(0);
  await expect(launch(page)).toBeFocused();
});
