import {test, expect, type Page} from '@playwright/test';

const base = process.env.FEATURED_BASE || 'http://127.0.0.1:3000';
test.use({hasTouch: true, viewport: {width: 390, height: 844}});
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none}'; document.head.append(style);
    });
  });
});
const dialog = (page: Page) => page.getByRole('dialog', {name: '更多分类'});
const settled = (page: Page) => dialog(page).evaluate(async element => {await Promise.all(element.getAnimations().map(animation => animation.finished));});

for (const width of [320, 390]) test(`category popup opens beside its trigger with a gentle entrance and exit at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height: 844});
  await page.goto(base + '/?view=category');
  const trigger = page.getByRole('button', {name: '更多分类', exact: true});
  const anchor = (await trigger.boundingBox())!;
  await trigger.click();
  const durations = await dialog(page).evaluate(element => element.getAnimations().map(animation => animation.effect?.getTiming().duration));
  expect(durations.length).toBeGreaterThan(0);
  for (const duration of durations) expect(Number(duration)).toBeGreaterThanOrEqual(400);
  await settled(page);
  const box = (await dialog(page).boundingBox())!;
  expect(Math.abs(box.y - anchor.y - anchor.height - 10)).toBeLessThan(2);
  expect(box.x).toBeGreaterThanOrEqual(11);
  expect(box.x + box.width).toBeLessThanOrEqual(width - 11);
  expect(box.y + box.height).toBeLessThan(700);
  await page.screenshot({path: info.outputPath('verified-anchored-popup.png')});
  await dialog(page).evaluate(element => {
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const start = performance.now();
      const observer = new MutationObserver(() => {
        if (!element.hasAttribute('open')) {element.setAttribute('data-exit-duration', String(performance.now() - start)); observer.disconnect();}
      });
      observer.observe(element, {attributes: true, attributeFilter: ['open']});
    }, {once: true});
  });
  await page.keyboard.press('Escape');
  await expect(dialog(page)).not.toBeVisible();
  expect(Number(await page.locator('#mh-more-categories').getAttribute('data-exit-duration'))).toBeGreaterThanOrEqual(400);
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).not.toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('short screens keep the popup in view and reduced motion still fades for at least 400ms', async ({page}) => {
  await page.setViewportSize({width: 667, height: 320});
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto(base + '/?view=category');
  await page.getByRole('button', {name: '更多分类', exact: true}).click();
  const animations = await dialog(page).evaluate(element => element.getAnimations().map(animation => ({
    duration: Number(animation.effect?.getTiming().duration), frames: (animation.effect as KeyframeEffect).getKeyframes(),
  })));
  expect(animations.some(animation => animation.duration >= 400)).toBe(true);
  expect(animations.flatMap(animation => animation.frames).every(frame => !frame.transform || frame.transform === 'none')).toBe(true);
  await settled(page);
  const box = (await dialog(page).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(10);
  expect(box.y + box.height).toBeLessThanOrEqual(310);
  await dialog(page).getByRole('button', {name: '文学', exact: true}).click();
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByRole('group', {name: '小说分类', exact: true}).getByRole('button').nth(8)).toHaveText('文学');
});

async function mockBooks(page: Page, total: string | null) {
  const requests: URL[] = [];
  // Ignore requests aborted by development Strict Mode's effect replay.
  page.on('requestfinished', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/books') requests.push(url);
  });
  await page.route('**/api/books?**', route => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get('page') || 1);
    const count = total === '0' ? 0 : Math.min(20, Math.max(0, 41 - (pageNumber - 1) * 20));
    const books = Array.from({length: count}, (_, index) => ({id: `status-${pageNumber}-${index}`, title: `测试作品 ${index + 1}`, author: '作者', description: '分类中的作品简介。', category: '玄幻', status: index % 2 ? 'completed' : 'ongoing'}));
    return route.fulfill({json: books, headers: total === null ? {} : {'X-Total-Count': total}});
  });
  return requests;
}

test('total pages reuse the paginated response, including the last page and category changes', async ({page}) => {
  const requests = await mockBooks(page, '41');
  await page.goto(base + '/?view=category');
  const pagination = page.getByRole('navigation', {name: '书籍分页'});
  await expect(pagination).toContainText('第 1 / 3 页');
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get('limit')).toBe('20');
  await pagination.getByRole('button', {name: '下一页'}).click();
  await expect(pagination).toContainText('第 2 / 3 页');
  await pagination.getByRole('button', {name: '下一页'}).click();
  await expect(pagination).toContainText('第 3 / 3 页');
  await expect(page.locator('.mobile-home .mh-book')).toHaveCount(1);
  await expect(pagination.getByRole('button', {name: '下一页'})).toBeDisabled();
  expect(requests).toHaveLength(3);
  await page.getByRole('button', {name: '仙侠', exact: true}).click();
  await expect(pagination).toContainText('第 1 / 3 页');
  expect(requests.at(-1)?.searchParams.get('category')).toBe('仙侠');
  expect(requests.at(-1)?.searchParams.get('page')).toBe('1');
});

test('empty results have zero pages and an outdated page URL is corrected', async ({page}) => {
  const requests = await mockBooks(page, '0');
  await page.goto(base + '/?view=category&page=9');
  const pagination = page.getByRole('navigation', {name: '书籍分页'});
  await expect(pagination).toContainText('共 0 页');
  await expect(pagination.getByRole('button', {name: '下一页'})).toBeDisabled();
  await expect(pagination.getByRole('button', {name: '上一页'})).toBeDisabled();
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  expect(requests).toHaveLength(2);
});

test('missing count headers do not invent a total', async ({page}) => {
  await mockBooks(page, null);
  await page.goto(base + '/?view=category');
  const pagination = page.getByRole('navigation', {name: '书籍分页'});
  await expect(page.locator('.mobile-home .mh-book')).toHaveCount(20);
  await expect(pagination.locator('span')).toHaveText('第 1 页');
  await expect(pagination.getByRole('button', {name: '下一页'})).toBeEnabled();
  await expect(page.locator('.mh-browse-summary')).not.toContainText('共 ');
});

test('ongoing and completed badges use distinct colors with equal readable emphasis in both themes', async ({page}, info) => {
  await mockBooks(page, '41');
  await page.goto(base + '/?view=category');
  const badges = page.locator('.mobile-home .mh-status');
  await expect(badges).toHaveCount(20);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
    if (theme === 'dark') await expect(page.getByRole('button', {name: '玄幻', exact: true})).toHaveCSS('background-color', 'rgb(46, 40, 35)');
    const styles = await badges.evaluateAll(elements => elements.slice(0, 2).map(element => {
      const style = getComputedStyle(element);
      const luminance = (rgb: string) => {
        const [r, g, b] = rgb.match(/\d+/g)!.slice(0, 3).map(value => {const c = Number(value) / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;});
        return .2126 * r + .7152 * g + .0722 * b;
      };
      const foreground = luminance(style.color), background = luminance(style.backgroundColor);
      return {color: style.color, background: style.backgroundColor, fontSize: style.fontSize, weight: style.fontWeight, height: element.getBoundingClientRect().height, contrast: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)};
    }));
    expect(styles[0].color).not.toBe(styles[1].color);
    expect(styles[0].background).not.toBe(styles[1].background);
    expect(styles[0].fontSize).toBe(styles[1].fontSize);
    expect(styles[0].weight).toBe(styles[1].weight);
    expect(styles[0].height).toBe(styles[1].height);
    expect(Math.abs(styles[0].contrast - styles[1].contrast)).toBeLessThan(1);
    for (const style of styles) expect(style.contrast).toBeGreaterThan(4.5);
    await page.screenshot({path: info.outputPath(`verified-status-${theme}.png`)});
  }
});
