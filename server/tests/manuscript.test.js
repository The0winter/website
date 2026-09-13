import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseManuscript,
  chapterNumber,
  validateManuscript,
} from "../services/manuscript.js";
import { readManuscriptFile } from "../services/manuscript-file.js";

test("Chinese/Arabic headings sort numerically and preserve prelude, duplicate chapters and paragraphs", () => {
  const result = parseManuscript(
    "\uFEFF书前寄语\r\n\r\n第十二章 归来\r\n第一段。\r\n\r\n第二段。\r\n第１０章 风起\r\n正文。\r\n第十章 重复\r\n末尾。",
  );
  assert.deepEqual(
    result.chapters.map((c) => c.sourceNumber),
    [null, 10, 10, 12],
  );
  assert.equal(result.chapters[0].content, "书前寄语");
  assert.equal(result.chapters[3].content, "第一段。\n\n第二段。");
  assert.ok(
    result.chapters.every(
      (c) => c.volumeTitle === "第一卷" && c.volumeNumber === 1,
    ),
  );
  assert.equal(result.warnings.length, 3);
  for (const [text, n] of [
    ["一百零二", 102],
    ["两千三百", 2300],
    ["壹仟零壹", 1001],
    ["一万零二", 10002],
    ["二〇二", 202],
  ])
    assert.equal(chapterNumber(text), n);
});

test("volumes and chapters sort independently with number resets, adjacent prose and special headings retained", () => {
  const result = parseManuscript(
    "第２卷 远行\n第10章 归来\n十。\n第一章 启程\n启程正文。\n第二章 路途\n路途正文。\n尾声\n结尾。\n第一卷 风起\n序章\n序。\n第二章 来信\n信。\n第一章 初遇\n初遇第一段。\n初遇第二段。",
  );
  assert.deepEqual(
    result.chapters.map((c) => [c.volumeTitle, c.volumeNumber, c.title]),
    [
      ["第一卷 风起", 1, "序章"],
      ["第一卷 风起", 1, "第一章 初遇"],
      ["第一卷 风起", 1, "第二章 来信"],
      ["第２卷 远行", 2, "第一章 启程"],
      ["第２卷 远行", 2, "第二章 路途"],
      ["第２卷 远行", 2, "第10章 归来"],
      ["第２卷 远行", 2, "尾声"],
    ],
  );
  assert.deepEqual(
    result.chapters.map((c) => c.content),
    [
      "序。",
      "初遇第一段。\n初遇第二段。",
      "信。",
      "启程正文。",
      "路途正文。",
      "十。",
      "结尾。",
    ],
  );
  assert.ok(result.warnings.some((w) => w.includes("按卷号")));
  assert.ok(!result.warnings.some((w) => w.includes("重复")));
  assert.equal(parseManuscript("前言\n开场白").chapters[0].title, "前言");
  const prelude = parseManuscript("书前寄语\n卷一 风起\n章一 初遇\n正文");
  assert.equal(new Set(prelude.chapters.map((c) => c.volumeNumber)).size, 1);
  assert.equal(prelude.chapters[0].content, "书前寄语");
  assert.equal(prelude.chapters[1].sourceNumber, 1);
  const empty = parseManuscript("第一卷\n第二卷\n正文");
  assert.deepEqual(
    empty.chapters.map((c) => c.content),
    ["", "正文"],
  );
});
test("no heading and empty chapters retain all content for review", () => {
  assert.equal(
    parseManuscript("完整的短篇。\n末尾。").chapters[0].content,
    "完整的短篇。\n末尾。",
  );
  assert.deepEqual(
    parseManuscript("第一章\n第二章\n正文").chapters.map((c) => c.content),
    ["", "正文"],
  );
  assert.throws(() => parseManuscript(""), /正文/);
  assert.throws(() => parseManuscript("x".repeat(2000001)), /200 万/);
});
test("book limits count Unicode characters; publish rejects missing content while drafts survive", () => {
  const data = {
    title: "😀".repeat(15),
    description: "简".repeat(300),
    cover_image: "",
    category: "玄幻",
    filename: "sample.txt",
    chapters: [{ title: "第一章", content: "" }],
  };
  assert.equal(validateManuscript(data).title, data.title);
  assert.throws(
    () => validateManuscript({ ...data, title: "😀".repeat(16) }),
    /15/,
  );
  assert.throws(
    () => validateManuscript({ ...data, description: "简".repeat(301) }),
    /300/,
  );
  assert.throws(() => validateManuscript(data, true), /正文为空/);
  assert.throws(
    () =>
      validateManuscript({
        ...data,
        chapters: [{ title: "章", content: "a".repeat(60001) }],
      }),
    /6 万/,
  );
});
test("real TXT encodings and DOC/DOCX extraction; disguised and corrupt files rejected", async () => {
  const source = "第一章 开始\n你好。\n第2章 继续\n再见。";
  for (const buffer of [
    Buffer.from(source),
    Buffer.concat([Buffer.from([255, 254]), Buffer.from(source, "utf16le")]),
  ]) {
    const parsed = await readManuscriptFile({
      originalname: "故事.TXT",
      buffer,
    });
    assert.equal(parsed.chapters.length, 2);
    assert.equal(parsed.chapters[1].content, "再见。");
  }
  const gb = await readManuscriptFile({
    originalname: "gbk.txt",
    buffer: Buffer.from("b5dad2bbd5c20ac4e3bac3a1a3", "hex"),
  });
  assert.equal(gb.encoding, "gb18030");
  assert.equal(gb.chapters[0].content, "你好。");
  const docx = await readManuscriptFile({
    originalname: "故事.docx",
    buffer: await readFile(
      new URL("./fixtures/manuscripts/chapters.docx", import.meta.url),
    ),
  });
  assert.equal(docx.chapters.length, 2);
  assert.equal(docx.chapters[1].content, "信里只写着一句话。");
  const doc = await readManuscriptFile({
    originalname: "asian.doc",
    buffer: await readFile(
      new URL("./fixtures/manuscripts/asian.doc", import.meta.url),
    ),
  });
  assert.ok(doc.chapters[0].content.length > 10);
  assert.match(doc.chapters[0].content, /[\u4e00-\u9fff]/);
  await assert.rejects(
    () =>
      readManuscriptFile({
        originalname: "fake.doc",
        buffer: Buffer.from(source),
      }),
    /扩展名/,
  );
  await assert.rejects(
    () =>
      readManuscriptFile({
        originalname: "broken.docx",
        buffer: Buffer.from("504b030400000000", "hex"),
      }),
    /无法读取/,
  );
  assert.throws(
    () =>
      readManuscriptFile({
        originalname: "book.pdf",
        buffer: Buffer.from(source),
      }),
    /TXT/,
  );
});
