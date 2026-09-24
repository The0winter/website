import {test, expect} from '@playwright/test';

const base = process.env.SEO_BASE || 'http://127.0.0.1:3000';

for (const width of [390, 1440]) {
  test(`book and chapter titles survive hydration, chapter changes and reload at ${width}px`, async ({page, request}) => {
    await page.setViewportSize({width, height: 844});
    await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint', 'true'));
    // This acceptance test must not send analytics or record reading visits.
    await page.route('**/*', route => {
      const target = new URL(route.request().url());
      return target.origin === new URL(base).origin && route.request().method() === 'GET' ? route.continue() : route.abort();
    });
    const booksResponse = await request.get(base + '/api/books?limit=6');
    expect(booksResponse.ok()).toBeTruthy();
    const books = await booksResponse.json();
    const book = books.find((item: {title: string}) => item.title !== '测试');
    expect(book).toBeTruthy();
    const detail = `${base}/book/${book.id || book._id}`;
    const chaptersResponse = await request.get(`${base}/api/books/${book.id || book._id}/chapters?order=asc&limit=2`);
    expect(chaptersResponse.ok()).toBeTruthy();
    const chapters = await chaptersResponse.json();
    expect(chapters.length).toBe(2);
    const title = [book.title.trim(), '最新完整章节', '在线免费阅读', book.author?.trim(), '笔趣阁'].filter(Boolean).join('_') + ' - 九天小说站';
    await page.goto(detail);
    await expect(page.locator('.book-detail')).toBeVisible();
    await expect(page).toHaveTitle(title);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', new RegExp('章节目录和在线免费阅读'));
    const first = chapters[0], second = chapters[1];
    const expectedChapter = (chapter: {title: string; chapter_number: number}) => `${chapter.title.trim().startsWith('第') ? chapter.title.trim() : `第${chapter.chapter_number}章 ${chapter.title.trim()}`} - ${book.title.trim()} - 九天小说站`;
    await page.goto(`${detail}/${first.id}`);
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
    await expect(page).toHaveTitle(expectedChapter(first));
    await page.keyboard.press('Control+ArrowRight');
    await expect(page).toHaveURL(`${detail}/${second.id}`);
    await expect(page).toHaveTitle(expectedChapter(second));
    await page.reload();
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
    await expect(page).toHaveTitle(expectedChapter(second));
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', expectedChapter(second));
  });
}
