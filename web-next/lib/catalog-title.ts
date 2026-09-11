// --- 智能处理章节标题 ---
export const formatChapterTitle = (title: string, chapterNumber: number) => {
  if (!title) return `第${chapterNumber}章`;

  // 1. 去掉开头的数字和标点符号 (例如 "7.第7章" -> "第7章", "12、第12章" -> "第12章")
  const cleanTitle = title.trim().replace(/^\d+[.、\s]+/, '');

  // 2. 识别是否为感言、请假条等非正文 (你可以根据需要增删这里的关键词)
  const isExtraContent = /(感言|同人|请假|通知|单章|说明|番外|新书|设定|总结|推书)/.test(cleanTitle);

  // 3. 如果清洗后的标题本身就已经包含“第x章”或者以“第”开头，直接原样返回（最准确，不依赖外部排序）
  if (cleanTitle.startsWith('第') || /第.+章/.test(cleanTitle)) {
      return cleanTitle;
  }

  // 4. 如果是感言等非正文，直接返回，绝对不要强制加“第X章”
  if (isExtraContent) {
      return cleanTitle;
  }

  // 5. 兜底逻辑：既没有“第X章”也不是感言的正文，才强制加上章节号
  return `第${chapterNumber}章 ${cleanTitle}`;
};
