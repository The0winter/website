import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

const base = process.env.MANUSCRIPT_BASE_URL || "http://127.0.0.1:3107";
async function createAndOpen(page: Page) {
  const title = await page.getByLabel("书名", {exact:true}).inputValue();
  await page.getByRole("button", {name:"创建",exact:true}).click();
  await page.locator('.writer-work').filter({hasText:title}).getByRole('button',{name:'创作',exact:true}).click();
  await expect(page.locator(".manuscript-work-title")).toHaveText(title);
  await expect(page.getByLabel("书名", {exact:true})).toHaveCount(0);
}
test.beforeEach(async ({ page }) => {
  const csrf = await (await page.request.get(base + "/api/auth/csrf")).json();
  const login = await page.request.post(base + "/api/auth/signin", {
    headers: { origin: base, "x-csrf-token": csrf.csrfToken },
    data: { email: "manuscript@example.test", password: "Manuscript-test-123" },
  });
  expect(login.ok()).toBe(true);
});
for (const width of [320, 390, 1440])
  test(`import, review, edit and resume whole draft at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const title = `测试${width}${Date.now().toString().slice(-6)}`;
    await page.goto(base + "/writer?action=new");
    await page.getByLabel("书名", { exact: true }).fill(title);
    await page
      .getByLabel("简介", { exact: true })
      .fill("一封信，让两个陌生人相遇。");
    await createAndOpen(page);
    await expect(page.getByLabel("简介", {exact:true})).toHaveCount(0);
    await expect(page.locator("input[type=file][accept*=image]")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "直接粘贴", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("把写好的故事，带到这里", { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".manuscript-header img")).toHaveAttribute(
      "src",
      /icon\.png/,
    );
    const widths = await page
      .locator(".manuscript-modes button")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(widths.length).toBe(2);
    expect(Math.abs(widths[0] - widths[1])).toBeLessThan(1);
    const alignment = await page
      .locator(".manuscript-import-heading")
      .evaluate((el) => ({
        right: el.getBoundingClientRect().right,
        summary: el.querySelector("button")!.getBoundingClientRect().right,
      }));
    expect(Math.abs(alignment.right - alignment.summary)).toBeLessThan(1);
    await page.getByText("格式示例", { exact: true }).click();
    await expect(page.locator(".manuscript-guide p")).toHaveText(
      "卷名或章名请单独成行，便于系统识别整理，中文或数字均可",
    );
    await expect(page.locator(".manuscript-guide li")).toHaveCount(0);
    expect(
      await page.locator(".manuscript-guide pre").textContent(),
    ).not.toContain("\n\n");
    const guideWidth = await page
      .locator(".manuscript-guide")
      .evaluate((el) => ({
        guide: el.getBoundingClientRect().width,
        parent: el.parentElement!.getBoundingClientRect().width,
      }));
    expect(Math.abs(guideWidth.guide - guideWidth.parent)).toBeLessThan(1);
    await expect(
      page.getByRole("link", { name: "下载 TXT 示例" }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("form.png"),
      fullPage: true,
    });
    await page.getByText("格式示例", { exact: true }).click();
    await page
      .getByLabel("上传文稿", { exact: true })
      .setInputFiles(
        path.resolve(
          __dirname,
          "../../server/tests/fixtures/manuscripts/chapters.docx",
        ),
      );
    await page.getByRole("button", { name: "识别并预览", exact: true }).click();
    await expect(page.locator(".manuscript-book-summary")).toContainText(
      "2 章",
    );
    await expect(page.locator(".manuscript-preview article")).toContainText(
      "清晨，书店刚刚开门。",
    );
    await page.getByRole("button", { name: "下一章", exact: true }).click();
    await expect(page.locator(".manuscript-preview article")).toContainText(
      "信里只写着一句话。",
    );
    await page.getByRole("button", { name: "修正本章" }).click();
    await page
      .getByLabel("章节正文", { exact: true })
      .fill("修正后保留下来的第二章正文。");
    await page.getByRole("button", { name: "查看阅读效果" }).click();
    await expect(
      page.getByRole("button", { name: "提交作品", exact: true }),
    ).toBeDisabled();
    expect(
      await page
        .locator(".manuscript-form")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("preview.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.locator(".manuscript-form")).toHaveCount(0);
    await expect(page).toHaveURL(base + "/writer");
    await page.reload();
    const row = page
      .locator(".writer-work")
      .filter({ hasText: title });
    await row.getByRole("button", { name: "创作" }).click();
    await page.getByRole("combobox", { name: "选择章节" }).selectOption("1");
    await expect(page.locator(".manuscript-preview article")).toContainText(
      "修正后保留下来的第二章正文。",
    );
    await page.getByRole("checkbox").check();
    const published = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" && r.url().includes("/api/manuscripts/"),
    );
    await page.getByRole("button", { name: "提交作品", exact: true }).click();
    const result = await (await published).json();
    expect(result.status).toBe("published");
    await expect(page.locator(".manuscript-form")).toHaveCount(0);
    const catalog = await (
      await page.request.get(
        base + `/api/books/${result.bookId}/chapters?order=asc`,
      )
    ).json();
    expect(catalog.length).toBe(2);
    const chapter = await (
      await page.request.get(base + "/api/chapters/" + catalog[1].id)
    ).json();
    expect(chapter.content).toBe("修正后保留下来的第二章正文。");
  });
test("unified writing and paste warnings, invalid metadata and recovery after failed save", async ({
  page,
}) => {
  await page.goto(base + "/writer?action=new");
  await page.getByLabel("书名", { exact: true }).fill("😀".repeat(16));
  await expect(
    page.getByRole("button", { name: "创建", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("书名", { exact: true }).fill("在线创作验收");
  await page.getByLabel("简介", { exact: true }).fill("简介");
  await createAndOpen(page);
  await page.getByRole("button", { name: "直接码字", exact: true }).click();
  await page
    .getByLabel("在线章节正文")
    .fill("前言。\n第一章 风起\n第二章 来信\n正文。\n第二章 重复\n末尾。");
  await page.getByRole("button", { name: "预览章节", exact: true }).click();
  await expect(page.locator(".manuscript-warnings")).toContainText("章号重复");
  await expect(page.locator(".manuscript-error")).toContainText("为空或超长");
  await page.getByRole("button", { name: "返回调整文稿" }).click();
  await page.getByRole("button", { name: "直接码字", exact: true }).click();
  await page.getByLabel("在线章节正文").fill("这是直接写下的第一章。");
  await page.getByRole("button", { name: "预览章节", exact: true }).click();
  await page
    .getByRole("button", { name: "添加章节，继续码字", exact: false })
    .click();
  await page.getByLabel("章节正文", { exact: true }).fill("这是第二章。");
  let failed = false;
  await page.route("**/api/manuscripts/*", async (route) => {
    if (route.request().method() === "PUT" && !failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        json: { error: "模拟网络失败，稍后重试" },
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.locator(".manuscript-form").getByRole("alert"),
  ).toContainText("模拟网络失败");
  await expect(page.getByLabel("章节正文", { exact: true })).toHaveValue(
    "这是第二章。",
  );
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.locator(".manuscript-form")).toHaveCount(0);
});

test("whole text in the writing tab preserves volumes through editing, resume and publication", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const title = "分卷" + Date.now().toString().slice(-8);
  await page.goto(base + "/writer?action=new");
  await page.getByLabel("书名", { exact: true }).fill(title);
  await page.getByLabel("简介", { exact: true }).fill("分卷整理验收。");
  await createAndOpen(page);
  await page.getByRole("button", { name: "直接码字", exact: true }).click();
  await page
    .getByLabel("在线章节正文")
    .fill(
      "第二卷 远行\n第二章 归来\n归来正文。\n第一章 启程\n启程正文。\n第一卷 风起\n第二章 来信\n来信正文。\n第一章 初遇\n初遇正文。",
    );
  await page.getByRole("button", { name: "预览章节", exact: true }).click();
  await expect(page.locator(".manuscript-book-summary")).toContainText(
    "2 卷 · 4 章",
  );
  await expect(page.locator(".manuscript-preview article")).toContainText(
    "初遇正文。",
  );
  await expect(page.locator("optgroup")).toHaveCount(2);
  expect(
    await page
      .locator("optgroup")
      .evaluateAll((els) => els.map((el) => el.getAttribute('label'))),
  ).toEqual(["第一卷 风起", "第二卷 远行"]);
  await page
    .getByRole("button", { name: "添加章节，继续码字", exact: false })
    .click();
  await page.getByLabel("章节正文", { exact: true }).fill("新增第三章。");
  await page.getByRole("button", { name: "查看阅读效果" }).click();
  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await expect(page.locator(".manuscript-preview-tools")).toContainText(
    "第二卷 远行",
  );
  await expect(page.locator(".manuscript-preview article")).toContainText(
    "启程正文。",
  );
  await page.screenshot({
    path: info.outputPath("volumes.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.locator(".manuscript-form")).toHaveCount(0);
  await expect(page).toHaveURL(base + "/writer");
  await page.reload();
  await page
    .locator(".writer-work")
    .filter({ hasText: title })
    .getByRole("button", { name: "创作" })
    .click();
  await expect(page.locator("optgroup")).toHaveCount(2);
  await page.getByRole("checkbox").check();
  const resultPromise = page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" && r.url().includes("/api/manuscripts/"),
  );
  await page.getByRole("button", { name: "提交作品", exact: true }).click();
  const result = await (await resultPromise).json();
  expect(result.status).toBe("published");
  await expect(page.locator(".manuscript-form")).toHaveCount(0);
  await expect(page).toHaveURL(base + "/writer");
  const catalog = await (
    await page.request.get(base + "/api/books/" + result.bookId + "/catalog")
  ).json();
  expect(
    catalog.volumes.map((v: { title: string; count: number }) => [
      v.title,
      v.count,
    ]),
  ).toEqual([
    ["第一卷 风起", 3],
    ["第二卷 远行", 2],
  ]);
  await page.goto(base + "/book/" + result.bookId);
  await page.getByRole('button',{name:/目录 连载至/}).click();
  await expect(
    page.getByText("第一卷 风起", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("第二卷 远行", { exact: true }).first(),
  ).toBeVisible();
});
