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
  "[0-9０-９零〇一二两兩三四五六七八九十百千万萬壹贰叁肆伍陆柒捌玖拾佰仟]+";
const heading = new RegExp(
  `^(?:第\\s*(${numeral})\\s*[章回节節]|章\\s*(${numeral}))(?:[\\s:：、.．—-]*(.*))?$`,
);
const volumeHeading = new RegExp(
  `^(?:第\\s*(${numeral})\\s*卷|卷\\s*(${numeral}))(?:[\\s:：、.．—-]*(.*))?$`,
);
const specialHeading =
  /^(?:序章|序言|前言|楔子|引子|后记|尾声|终章|番外(?:[一二三四五六七八九十0-9]+)?)(?:$|[\s:：、—-].*)/;

export function chapterNumber(text) {
  const s = text.normalize("NFKC");
  if (/^\d+$/.test(s)) return Number(s);
  const digits = "零一二三四五六七八九";
  const aliases = {
    〇: "零",
    两: "二",
    兩: "二",
    萬: "万",
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
  const groups = [],
    warnings = [];
  let volume = null,
    current = null;
  const makeVolume = (title, number, implicit = false) => {
    const group = { title, number, chapters: [], implicit };
    groups.push(group);
    return group;
  };
  const ensureVolume = () => (volume ||= makeVolume("第一卷", 1, true));
  let chapterCount = 0;
  const startChapter = (title, number, implicit = false) => {
    if (++chapterCount > manuscriptLimits.chapters)
      invalid("单次最多支持 2000 章");
    current = { title, sourceNumber: number, content: [], implicit };
    ensureVolume().chapters.push(current);
  };
  for (const line of text.split("\n")) {
    const title = line.trim();
    const volumeMatch = title.length <= 100 && volumeHeading.exec(title);
    if (volumeMatch) {
      const number = chapterNumber(volumeMatch[1] || volumeMatch[2]);
      if (
        groups.length === 1 &&
        volume?.implicit &&
        volume.chapters.every((c) => c.implicit)
      ) {
        volume.title = title;
        volume.number = number;
        volume.implicit = false;
      }
      // A repeated heading resumes the same volume rather than splitting its chapters.
      volume =
        groups.find((g) => g.number === number && g.title === title) ||
        makeVolume(title, number);
      if (groups.length > manuscriptLimits.chapters)
        invalid("单次最多支持 2000 卷");
      current = null;
      continue;
    }
    const match = title.length <= 100 && heading.exec(title);
    if (match) startChapter(title, chapterNumber(match[1] || match[2]));
    else if (title.length <= 100 && specialHeading.test(title))
      startChapter(title, null);
    else if (current) current.content.push(line);
    else if (title) {
      startChapter("前言", null, true);
      current.content.push(line);
    }
  }
  // A volume with prose but no explicit chapters is still a readable chapter.
  for (const group of groups) {
    if (!group.chapters.length) {
      group.chapters.push({ title: "第一章", sourceNumber: null, content: [] });
      warnings.push(`「${group.title}」没有正文，请补全或移除空章。`);
    } else if (group.chapters.length === 1 && group.chapters[0].implicit) {
      group.chapters[0].title = "第一章";
      warnings.push(`「${group.title}」未识别到章标题，正文已完整保留为一章。`);
    }
  }
  const originalVolumes = [...groups];
  groups.sort((a, b) => a.number - b.number);
  if (groups.some((g, i) => g !== originalVolumes[i]))
    warnings.push("已按卷号重新排列各卷，请核对预览。");
  const chapters = [];
  for (const [volumeIndex, group] of groups.entries()) {
    const seen = new Set();
    // Unnumbered prologues/epilogues stay at their original boundaries. Sort each
    // consecutive numbered run, keeping duplicate numbers stable and retaining all text.
    for (let start = 0; start < group.chapters.length;) {
      if (group.chapters[start].sourceNumber === null) {
        start++;
        continue;
      }
      let end = start + 1;
      while (
        end < group.chapters.length &&
        group.chapters[end].sourceNumber !== null
      )
        end++;
      const run = group.chapters.slice(start, end),
        sorted = [...run].sort((a, b) => a.sourceNumber - b.sourceNumber);
      if (sorted.some((c, i) => c !== run[i]))
        warnings.push(`「${group.title}」已按章号重新排列，请核对预览。`);
      group.chapters.splice(start, end - start, ...sorted);
      start = end;
    }
    let previous = null;
    for (const chapter of group.chapters) {
      if (chapter.sourceNumber !== null) {
        if (seen.has(chapter.sourceNumber))
          warnings.push(
            `「${group.title} · ${chapter.title}」章号重复，已保留全部内容，请核对。`,
          );
        else if (previous !== null && chapter.sourceNumber !== previous + 1)
          warnings.push(
            `「${group.title} · ${chapter.title}」与上一章不连续，请核对。`,
          );
        seen.add(chapter.sourceNumber);
        previous = chapter.sourceNumber;
      }
      chapters.push({
        title: chapter.title,
        sourceNumber: chapter.sourceNumber,
        content: chapter.content.join("\n").trim(),
        volumeTitle: group.title,
        volumeNumber: volumeIndex + 1,
      });
    }
  }
  if (chapters.length > manuscriptLimits.chapters)
    invalid("单次最多支持 2000 章");
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
    if (publish && !chapter.content.trim())
      invalid(`第 ${index + 1} 项正文为空，请补全或移除空章`);
    if (
      chapter.volumeTitle !== undefined &&
      (typeof chapter.volumeTitle !== "string" ||
        !chapter.volumeTitle.trim() ||
        chapter.volumeTitle.length > 100)
    )
      invalid("卷名须在 100 字符以内");
    if (
      chapter.volumeNumber !== undefined &&
      (!Number.isSafeInteger(chapter.volumeNumber) ||
        chapter.volumeNumber < 1 ||
        chapter.volumeNumber > manuscriptLimits.chapters)
    )
      invalid("卷序无效");
    total += chapter.content.length;
    return {
      volumeTitle: chapter.volumeTitle?.trim() || "第一卷",
      volumeNumber: chapter.volumeNumber ?? 1,
      title: chapter.title.trim() || `第${index + 1}章`,
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
