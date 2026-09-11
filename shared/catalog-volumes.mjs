/** @typedef {{id: string, title: string, start: number, count: number}} CatalogVolume */
const digits = '0-9０-９零〇一二三四五六七八九十百千万萬两兩';
const volumeStart = new RegExp(`^(?:第[${digits}]+卷|卷[${digits}]+)`, 'u');
const chapterStart = new RegExp(`第[${digits}]+[章回节節]`, 'u');

// Only explicit volume labels define boundaries. Chapter-number resets and
// words such as “番外” inside an ordinary chapter title are not volume markers.
export function splitCatalogTitle(title = '') {
  const text = title.trim();
  const numbered = volumeStart.exec(text);
  if (numbered) {
    const chapter = chapterStart.exec(text.slice(numbered[0].length));
    const boundary = chapter ? numbered[0].length + chapter.index : -1;
    return {volume: (boundary < 0 ? text : text.slice(0, boundary)).trim(), chapterTitle: boundary < 0 ? text : text.slice(boundary)};
  }
  const section = /^(正文(?:卷|篇)?|番外(?:卷|篇)?)(?=$|[\s:：、（(\d０-９一二三四五六七八九十]|第)/u.exec(text);
  if (section) {
    const chapter = chapterStart.exec(text.slice(section[0].length));
    return {volume: section[0].startsWith('正文') ? '正文' : '番外', chapterTitle: chapter ? text.slice(section[0].length + chapter.index) : text};
  }
  return {volume: '', chapterTitle: text};
}

/** @param {{id?: string, _id?: unknown, title: string}[]} chapters */
export function buildCatalogVolumes(chapters) {
  /** @type {CatalogVolume[]} */
  const volumes = [];
  let title = '正文';
  chapters.forEach((chapter, index) => {
    title = splitCatalogTitle(chapter.title).volume || title;
    let volume = volumes[volumes.length - 1];
    if (!volume || volume.title !== title) {
      volume = {id: String(chapter.id ?? chapter._id ?? index), title, start: index, count: 0};
      volumes.push(volume);
    }
    volume.count++;
  });
  return volumes;
}
