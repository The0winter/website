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
  await page.getByRole('button', { name: '返回上一页' }).click(); await expect(modal(page)).toHaveCount(0);
});

for (const width of [320, 390]) test(`creator actions open the matching creation, editor and draft-management views at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(base); await launch(page).click();
  await modal(page).getByRole('link', { name: /新建作品/ }).click();
  await expect(page.getByPlaceholder('请输入书名')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`create-${width}.png`) });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.mw-view')).toHaveCount(0);
  await expect(modal(page)).toBeVisible();
  await modal(page).getByRole('link', { name: '写一章', exact: true }).click();
  await expect(page.getByPlaceholder('请输入章节标题')).toBeVisible();
  await expect(page.getByRole('button', { name: '存草稿', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`editor-${width}.png`) });
  await page.goBack(); await expect(page.locator('.mw-view')).toHaveCount(0); await expect(modal(page)).toBeVisible();
  await modal(page).getByRole('link', { name: '目录与草稿', exact: true }).click();
  await expect(page.getByText('目录与设置', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`manager-${width}.png`) });
  await page.getByRole('button', { name: '继续草稿', exact: true }).click();
  await expect(page.getByPlaceholder('在这里开始你的创作...')).toHaveValue('留给自己的未发布草稿。');
});

for (const width of [320, 390]) for (const action of ['新建作品', '作品管理']) {
  test(`${action} returns to the creation center with browser and page Back at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base);
    const initialLength = await page.evaluate(() => history.length);
    await launch(page).click();
    const marker = await page.evaluate(() => history.state.mobileWriter);
    await modal(page).getByRole('link', { name: new RegExp(action) }).click();
    await expect(page.getByRole('dialog', { name: action, exact: true })).toBeVisible();
    if (action === '新建作品') await expect(page.getByPlaceholder('请输入书名')).toBeVisible();
    await page.goBack();
    await expect(page.locator('.mw-view')).toHaveCount(0);
    await expect(modal(page)).toBeVisible();
    expect(await page.evaluate(() => history.state.mobileWriter)).toBe(marker);
    expect(await page.evaluate(() => history.length)).toBe(initialLength + 2);

    await page.goForward();
    await expect(page.getByRole('dialog', { name: action, exact: true })).toBeVisible();
    await expect(modal(page)).toBeVisible();
    // Reloading a child route must retain the same parent history entry.
    await page.reload();
    if (action === '新建作品') await page.getByRole('button', { name: '取消', exact: true }).click();
    else await page.getByRole('button', { name: '返回创作中心', exact: true }).click();
    await expect(page.locator('.mw-view')).toHaveCount(0);
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).getByRole('heading', { name: book.title })).toBeVisible();
    expect(await page.evaluate(() => history.state.mobileWriter)).toBe(marker);
    expect(await page.evaluate(() => history.length)).toBe(initialLength + 2);
    await page.goBack();
    await expect(modal(page)).toHaveCount(0);
    await expect(launch(page)).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });
}

test('returning from work management restores the creation center over its forum entry', async ({ page }) => {
  await page.goto(`${base}/forum`);
  await launch(page).click();
  await modal(page).getByRole('link', { name: /作品管理/ }).click();
  await page.getByRole('button', { name: '返回创作中心', exact: true }).click();
  await expect(page.locator('.mw-view')).toHaveCount(0);
  await expect(page).toHaveURL(`${base}/forum`);
  await expect(modal(page)).toBeVisible();
  await modal(page).getByRole('button', { name: '返回上一页' }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect(page).toHaveURL(`${base}/forum`);
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

for (const width of [320, 390]) for (const action of ['新建作品', '作品管理']) {
  test(`${action} keeps the center mounted and loads inside a 400ms sliding panel at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base); await launch(page).click();
    await expect(modal(page)).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => {
      const center = document.querySelector<HTMLDialogElement>('.mw-dialog')!;
      const probe = { done: false, frames: [] as boolean[], opened: 0, ready: 0, radialRestarts: 0, motion: [] as { name: string; duration: number; x: number; y: number }[] };
      Object.assign(window, { writerLayerProbe: probe });
      const observer = new MutationObserver(() => {
        if (!probe.opened && document.querySelector('.mw-view-loading')) probe.opened = performance.now();
        if (!probe.ready && document.querySelector('.mw-view-panel[data-ready=true]')) probe.ready = performance.now();
        if (probe.done) observer.disconnect();
      });
      observer.observe(center, { childList: true, subtree: true, attributes: true });
      document.addEventListener('animationstart', event => {
        if (event.animationName === 'mw-reveal-in') probe.radialRestarts++;
        if (!(event.target as HTMLElement).matches('.mw-view-panel')) return;
        const style = getComputedStyle(event.target as HTMLElement);
        const transform = new DOMMatrix(style.transform);
        probe.motion.push({ name: event.animationName, duration: parseFloat(style.animationDuration) * 1000, x: transform.m41, y: transform.m42 });
      });
      function sample() {
        probe.frames.push(center.isConnected && center.open && center.dataset.ready === 'true' && getComputedStyle(center.querySelector('.mw-reveal')!).transform === 'none');
        if (!probe.done) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    await modal(page).getByRole('link', { name: new RegExp(action) }).click();
    const panel = page.locator('.mw-view-panel');
    await expect(panel).toHaveAttribute('data-ready', 'true');
    const geometry = await panel.evaluate(element => {
      const box = element.getBoundingClientRect();
      return { height: box.height, top: box.top, viewport: innerHeight };
    });
    if (action === '新建作品') { expect(geometry.height).toBeLessThan(geometry.viewport); expect(geometry.top).toBeGreaterThan(0); }
    else expect(geometry.height).toBe(geometry.viewport);
    await page.screenshot({ path: info.outputPath(`loaded-${action}-${width}.png`) });
    if (action === '新建作品') await page.getByRole('button', { name: '取消', exact: true }).click();
    else await page.getByRole('button', { name: '返回创作中心', exact: true }).click();
    await expect(page.locator('.mw-view')).toHaveCount(0);
    const probe = await page.evaluate(() => {
      const probe = (window as Window & { writerLayerProbe?: { done: boolean; frames: boolean[]; opened: number; ready: number; radialRestarts: number; motion: { name: string; duration: number; x: number; y: number }[] } }).writerLayerProbe!;
      probe.done = true; return probe;
    });
    expect(probe.ready - probe.opened).toBeGreaterThanOrEqual(400);
    expect(probe.frames.length).toBeGreaterThan(10);
    expect(probe.frames.every(Boolean)).toBe(true);
    expect(probe.radialRestarts).toBe(0);
    const entry = probe.motion.find(motion => motion.name.endsWith('-in'))!;
    expect(entry.duration).toBeGreaterThanOrEqual(400);
    expect(probe.motion.find(motion => motion.name.endsWith('-out'))!.duration).toBeGreaterThanOrEqual(400);
    if (action === '新建作品') { expect(entry.name).toBe('mw-view-sheet-in'); expect(entry.y).toBeGreaterThan(0); expect(entry.x).toBe(0); }
    else { expect(entry.name).toBe('mw-view-slide-in'); expect(entry.x).toBeGreaterThan(0); expect(entry.y).toBe(0); }
    await expect(modal(page).getByRole('heading', { name: book.title })).toBeVisible();
  });
}

test('slow management data keeps its loading panel visible and Back cancels an unfinished entry', async ({ page }) => {
  await page.goto(base); await launch(page).click();
  await expect(modal(page).getByRole('heading', { name: book.title })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const requested = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/books?**', async route => {
    if (new URL(route.request().url()).searchParams.get('author_id') !== account.id) return route.continue();
    started(); await gate; await route.fulfill({ json: [book] });
  });
  try {
    await modal(page).getByRole('link', { name: /作品管理/ }).click();
    await requested;
    await expect(page.locator('.mw-view-loading')).toBeVisible();
    await expect(page.locator('.mw-view-panel')).toHaveAttribute('data-ready', 'false');
    await page.goBack();
    await expect(page.locator('.mw-view')).toHaveCount(0);
    release();
    await expect(modal(page).getByRole('heading', { name: book.title })).toBeVisible();
    await modal(page).getByRole('link', { name: /新建作品/ }).click();
    await expect(page.locator('.mw-view-loading')).toBeVisible();
    const box = await page.locator('.mw-view-loading').boundingBox();
    expect(box!.y).toBeGreaterThan(0); expect(box!.height).toBeLessThan(844);
    await page.keyboard.press('Escape');
    await expect(page.locator('.mw-view')).toHaveCount(0);
    await expect(modal(page)).toBeVisible();
  } finally { release(); }
});

test('new work opened from management returns to the same management layer before the center', async ({ page }) => {
  await page.goto(base); await launch(page).click();
  await modal(page).getByRole('link', { name: /作品管理/ }).click();
  await expect(page.locator('.mw-view-panel')).toHaveAttribute('data-ready', 'true');
  const id = await page.evaluate(() => history.state.mobileWriterViews[0].id);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByPlaceholder('请输入书名')).toBeVisible();
  await expect(page.locator('.mw-view')).toHaveCount(2);
  await page.getByRole('button', { name: '关闭新建作品', exact: true }).click();
  await expect(page.locator('.mw-view')).toHaveCount(1);
  expect(await page.evaluate(() => history.state.mobileWriterViews[0].id)).toBe(id);
  await expect(page.locator('.writer-work').getByRole('heading', { name: book.title })).toBeVisible();
  await page.goBack(); await expect(page.locator('.mw-view')).toHaveCount(0);
  await expect(modal(page)).toBeVisible();
});

test('creating a work closes the sheet directly and refreshes the retained center', async ({ page }) => {
  let created = false;
  const newBook = { ...book, id: '000000000000000000000200', title: '新故事' };
  await page.route('**/api/books', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    created = true; await route.fulfill({ json: newBook });
  });
  await page.route('**/api/books?**', route => new URL(route.request().url()).searchParams.get('author_id') === account.id ? route.fulfill({ json: created ? [newBook, book] : [book] }) : route.continue());
  await page.goto(base); await launch(page).click();
  await modal(page).getByRole('link', { name: /新建作品/ }).click();
  await page.getByPlaceholder('请输入书名').fill(newBook.title);
  await page.getByRole('button', { name: '立即创建', exact: true }).click();
  await expect(page.locator('.mw-view')).toHaveCount(0);
  await expect(modal(page).getByRole('heading', { name: newBook.title })).toBeVisible();
});

test('direct desktop writer entry retains its creation form and management page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/writer`);
  await page.getByRole('button', { name: '创建新书', exact: true }).click();
  await expect(page.getByPlaceholder('请输入书名')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.writer-create-modal')).toHaveCount(0);
  await expect(page.locator('.writer-work').getByRole('heading', { name: book.title })).toBeVisible();
});
