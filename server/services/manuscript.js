export const manuscriptLimits = {
  bytes: 10 * 1024 * 1024,
  characters: 2000000,
  chapters: 2000,
};
const invalid = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};
const count = (text) => Array.from(text).length;
const numeral =
  "[0-9０-９零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+";
const heading = new RegExp(
  `^第\\s*(${numeral})\\s*章(?:[\\s:：、.．—-]*(.*))?$`,
);

export function chapterNumber(text) {
  const s = text.normalize("NFKC");
  if (/^\d+$/.test(s)) return Number(s);
  const digits = "零一二三四五六七八九";
  const aliases = {
    〇: "零",
    两: "二",
    壹: "一",
    贰: "二",
    叁: "三",
    肆: "四",
    伍: "五",
    陆: "六",
    柒: "七",
    捌: "八",
    玖: "九",
    拾: "十",
    佰: "百",
    仟: "千",
  };
  const chars = [...s].map((c) => aliases[c] || c);
  if (chars.every((c) => digits.includes(c)))
    return Number(chars.map((c) => digits.indexOf(c)).join(""));
  let total = 0,
    section = 0,
    digit = 0;
  for (const c of chars) {
    if (digits.includes(c)) digit = digits.indexOf(c);
    else if (c === "万") {
      total += (section + digit || 1) * 10000;
      section = digit = 0;
    } else {
      section += (digit || 1) * ({ 十: 10, 百: 100, 千: 1000 }[c] || 0);
      digit = 0;
    }
  }
  return total + section + digit;
}

export function parseManuscript(source) {
  if (typeof source !== "string" || source.length > manuscriptLimits.characters)
    invalid("文稿最多支持 200 万字符，请分批整理后上传");
  const text = source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u000b/g, "\n")
    .trim();
  if (!text || /[\u0000-\u0008\u000e-\u001f]/.test(text))
    invalid("没有可读取的正文，或文件并非纯文本；请另存为 TXT 或 Word 后重试");
  const chapters = [],
    warnings = [],
    prelude = [];
  let current = null;
  for (const line of text.split("\n")) {
    const title = line.trim();
    const match = title.length <= 100 && heading.exec(title);
    if (match) {
      current = { title, content: [], sourceNumber: chapterNumber(match[1]) };
      chapters.push(current);
    } else if (current) current.content.push(line);
    else prelude.push(line);
  }
  if (prelude.join("\n").trim()) {
    chapters.unshift({
      title: chapters.length ? "前言" : "第一章",
      content: prelude,
      sourceNumber: null,
    });
    warnings.push(
      chapters.length > 1
        ? "首个章标题前的文字已保留为「前言」，请检查是否包含书名或目录。"
        : "没有识别到独立成行的「第×章」，已将全部正文保留为一章；可返回调整原文后重新识别。",
    );
  }
  if (chapters.length > manuscriptLimits.chapters)
    invalid("单次最多支持 2000 章");
  let previous = null;
  const seen = new Set();
  for (const chapter of chapters) {
    if (chapter.sourceNumber !== null) {
      if (seen.has(chapter.sourceNumber))
        warnings.push(`「${chapter.title}」的章号重复，请检查是否混入目录。`);
      else if (previous !== null && chapter.sourceNumber !== previous + 1)
        warnings.push(`「${chapter.title}」与上一章不连续，已保留原文顺序。`);
      seen.add(chapter.sourceNumber);
      previous = chapter.sourceNumber;
    }
    chapter.content = chapter.content.join("\n").trim();
  }
  return {
    chapters,
    warnings: warnings.slice(0, 30),
    totalCharacters: chapters.reduce((n, c) => n + count(c.content), 0),
  };
}

export function validateManuscript(body, publish = false) {
  if (!body || typeof body !== "object") invalid("作品资料无效");
  const result = {};
  for (const [key, max] of [
    ["title", 15],
    ["description", 300],
    ["cover_image", 2000],
    ["category", 20],
    ["filename", 255],
  ]) {
    if (typeof body[key] !== "string" || count(body[key]) > max)
      invalid(
        {
          title: "书名须在 15 个字符以内",
          description: "简介须在 300 个字符以内",
        }[key] || "作品资料长度无效",
      );
    result[key] = body[key].trim();
  }
  if (!result.title) invalid("请填写书名");
  if (publish && !result.description) invalid("提交前请填写简介");
  if (
    !Array.isArray(body.chapters) ||
    body.chapters.length > manuscriptLimits.chapters ||
    (publish && !body.chapters.length)
  )
    invalid("请先导入文稿并检查章节");
  let total = 0;
  result.chapters = body.chapters.map((chapter, index) => {
    if (
      !chapter ||
      typeof chapter.title !== "string" ||
      chapter.title.length > 100 ||
      typeof chapter.content !== "string" ||
      chapter.content.length > 60000
    )
      invalid(
        `第 ${index + 1} 项标题最多 100 字、正文最多 6 万字符，请拆分过长章节`,
      );
    if (publish && (!chapter.title.trim() || !chapter.content.trim()))
      invalid(`第 ${index + 1} 项标题或正文为空，请补全或移除空章`);
    total += chapter.content.length;
    return {
      title: chapter.title.trim(),
      content: chapter.content,
      sourceNumber: Number.isSafeInteger(chapter.sourceNumber)
        ? chapter.sourceNumber
        : null,
    };
  });
  if (total > manuscriptLimits.characters) invalid("文稿最多支持 200 万字符");
  result.totalCharacters = total;
  return result;
}
