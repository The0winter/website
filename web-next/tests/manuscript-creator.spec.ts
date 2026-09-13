import { test, expect } from "@playwright/test";
import path from "node:path";

const base = process.env.MANUSCRIPT_BASE_URL || "http://127.0.0.1:3107";
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
    await expect(page.getByText("非必须", { exact: true })).toBeVisible();
    await page.getByText("格式示例与说明", { exact: true }).click();
    await expect(
      page.getByRole("link", { name: "下载 TXT 示例" }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("form.png"),
      fullPage: true,
    });
    await page.getByText("格式示例与说明", { exact: true }).click();
    await page
      .getByLabel("上传文稿", { exact: true })
      .setInputFiles(
        path.resolve(__dirname, "../../server/tests/fixtures/manuscripts/chapters.docx"),
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
      .locator(".manuscript-drafts>div")
      .filter({ hasText: title });
    await row.getByRole("button", { name: "继续整理" }).click();
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
test("paste warnings, invalid metadata, online writing and recovery after failed save", async ({
  page,
}) => {
  await page.goto(base + "/writer?action=new");
  await page.getByLabel("书名", { exact: true }).fill("😀".repeat(16));
  await expect(
    page.getByRole("button", { name: "保存草稿", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("书名", { exact: true }).fill("在线创作验收");
  await page.getByLabel("简介", { exact: true }).fill("简介");
  await page.getByRole("button", { name: "直接粘贴", exact: true }).click();
  await page
    .getByLabel("粘贴文稿")
    .fill("前言。\n第一章 风起\n第二章 来信\n正文。\n第二章 重复\n末尾。");
  await page.getByRole("button", { name: "识别并预览", exact: true }).click();
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
  await expect(page.locator(".manuscript-form").getByRole("alert")).toContainText("模拟网络失败");
  await expect(page.getByLabel("章节正文", { exact: true })).toHaveValue(
    "这是第二章。",
  );
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.locator(".manuscript-form")).toHaveCount(0);
});
