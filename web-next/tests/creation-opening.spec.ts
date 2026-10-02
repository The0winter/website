import {test, expect} from './fixtures/without-analytics';

const base = process.env.CREATION_BASE_URL || 'http://127.0.0.1:3000';
const account = {id: '000000000000000000000099', username: '开场测试', role: 'reader'};
const book = {id: '000000000000000000000199', title: '等待加载的故事', author_id: account.id};

test.beforeEach(async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.route('**/api/auth/session', route => route.fulfill({json: {user: account, profile: account}}));
  await page.route('**/api/auth/csrf', route => route.fulfill({json: {csrfToken: 'opening-test'}}));
  await page.route('**/api/auth/activity', route => route.fulfill({json: {success: true}}));
  await page.route('**/api/traffic/observe', route => route.fulfill({json: {}}));
  await page.route('**/api/books/*/views', route => route.fulfill({json: {success: true, counted: false}}));
});

test('a cold tap animates before any work response or new JavaScript download', async ({page}, info) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  let requestedAfterReveal = false;
  await page.route('**/api/writer/works?**', async route => {
    requestedAfterReveal = await page.locator('.mw-dialog').getAttribute('data-ready') === 'true';
    await held;
    await route.fulfill({json: [book]});
  });
  await page.goto(base);
  const launcher = page.getByRole('button', {name: '创作', exact: true});
  await expect(launcher).toBeVisible();
  // Hold every subsequent script/CSS chunk. A lazy-loaded shell cannot pass.
  await page.route('**/_next/static/**', async route => {
    if (['script', 'stylesheet'].includes(route.request().resourceType())) await held;
    await route.continue();
  });
  await page.evaluate(() => {
    const timing = {tap: 0, started: 0};
    Object.assign(window, {creationTiming: timing});
    document.querySelector('.mh-create')!.addEventListener('click', () => {timing.tap = performance.now();}, {once: true});
    document.addEventListener('animationstart', event => {if (event.animationName === 'mw-reveal-in') timing.started = performance.now();});
  });
  try {
    await launcher.click();
    const center = page.getByRole('dialog', {name: '创作中心', exact: true});
    await expect(center).toHaveAttribute('data-ready', 'true');
    await expect.poll(() => requestedAfterReveal).toBe(true);
    const timing = await page.evaluate(() => (window as Window & {creationTiming?: {tap: number; started: number}}).creationTiming!);
    expect(timing.started).toBeGreaterThan(timing.tap);
    expect(timing.started - timing.tap).toBeLessThan(250);
    await expect(center.locator('.mw-book')).toHaveCount(0);
    await expect(center.getByRole('status')).toContainText('正在翻开你的作品');
    await info.attach('opening-timing', {body: JSON.stringify(timing), contentType: 'application/json'});
    await page.goBack();
    await expect(center).toHaveCount(0);
    await expect(launcher).toBeFocused();
    release();
    await launcher.click();
    await expect(center.getByRole('heading', {name: book.title})).toBeVisible();
  } finally {release();}
});

for (const visualViewport of [true, false]) test(`full-height center without dynamic viewport CSS, visual viewport ${visualViewport}`, async ({page}, info) => {
  if (!visualViewport) await page.addInitScript(() => Object.defineProperty(window, 'visualViewport', {value: undefined}));
  // Simulate a kernel rejecting dvh declarations, rather than just changing UA.
  await page.route('**/*.css*', async route => {
    const response = await route.fetch();
    const css = (await response.text()).replace(/[^{};]+:[^{};]*dvh\b[^{};]*(?=[;}])/g, '');
    await route.fulfill({response, body: css, contentType: 'text/css'});
  });
  await page.route('**/api/writer/works?**', route => route.fulfill({json: Array.from({length: 20}, (_,i) => ({...book, id: String(i), title: `故事 ${i + 1}`}))}));
  await page.goto(base);
  await page.getByRole('button', {name: '创作', exact: true}).click();
  const center = page.locator('.mw-dialog');
  await expect(center).toHaveAttribute('data-ready', 'true');
  await expect(center.locator('.mw-book')).toHaveCount(20);
  for (const height of [844, 560, 360, 760]) {
    await page.setViewportSize({width: 390, height});
    await expect.poll(async () => (await center.boundingBox())?.height).toBe(height);
    const scroll = center.locator('.mw-scroll');
    await scroll.evaluate(element => {element.scrollTop = element.scrollHeight;});
    const next = center.getByRole('button', {name: '下一页'});
    await expect(next).toBeInViewport();
    const box = (await next.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    expect(await center.evaluate(element => getComputedStyle(element).clipPath)).toBe('none');
  }
  await page.screenshot({path: info.outputPath(`verified-full-height-${visualViewport}.png`)});
  await center.locator('.mw-scroll').evaluate(element => {element.scrollTop = 0;});
  await center.getByRole('link', {name: /新建作品/}).click();
  await expect(page.getByLabel('书名', {exact: true})).toBeVisible();
  const sheet = page.locator('.mw-view-panel');
  await expect(sheet).toHaveCSS('height', '430px');
  await page.setViewportSize({width: 390, height: 360});
  await expect(sheet).toHaveCSS('height', '328px');
  await expect(page.getByRole('button', {name: '关闭新建作品'})).toBeInViewport();
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  await page.goBack();
  await expect(center).toHaveCount(0);
});
