/** @typedef {{id: string, title: string, start: number, count: number}} CatalogVolume */
const digits = '0-9０-９零〇一二三四五六七八九十百千万萬两兩';
const volumeStart = new RegExp(`^(?:第[${digits}]+卷|卷[${digits}]+)`, 'u');
const chapterStart = new RegExp(`第[${digits}]+[章回节節]`, 'u');

// Only numbered volume prefixes define legacy title boundaries. “正文”,
// “番外” and numbering resets are chapter text, never sticky classifications.
export function splitCatalogTitle(title = '') {
  const text = title.trim();
  const numbered = volumeStart.exec(text);
  if (numbered) {
    const chapter = chapterStart.exec(text.slice(numbered[0].length));
    const boundary = chapter ? numbered[0].length + chapter.index : -1;
    // A chapter titled “第一卷 结束以及请假” is not a source volume heading.
    // Named standalone headings need explicit volume metadata; legacy titles
    // may define a volume only with an actual chapter prefix or a bare marker.
    if (boundary < 0 && text !== numbered[0]) return {volume: '', chapterTitle: text};
    return {volume: (boundary < 0 ? text : text.slice(0, boundary)).trim(), chapterTitle: boundary < 0 ? text : text.slice(boundary)};
  }
  return {volume: '', chapterTitle: text};
}

/** @param {{id?: string, _id?: unknown, title: string, volume_title?: string, volume_number?: number}[]} chapters */
export function buildCatalogVolumes(chapters) {
  /** @type {CatalogVolume[]} */
  const volumes = [];
  let title = '';
  let number;
  chapters.forEach((chapter, index) => {
    const explicit = typeof chapter.volume_title === 'string' && chapter.volume_title.trim();
    const newNumber = explicit ? chapter.volume_number : number;
    title = explicit || splitCatalogTitle(chapter.title).volume || title;
    let volume = volumes[volumes.length - 1];
    if (!volume || volume.title !== title || newNumber !== number) {
      volume = {id: String(chapter.id ?? chapter._id ?? index), title, start: index, count: 0};
      volumes.push(volume);
    }
    volume.count++;
    number = newNumber;
  });
  // An empty array means a flat catalog, not an empty book. Keep an unlabelled
  // preface before real volumes as rows without inventing another volume name.
  if (!volumes.some(volume => volume.title) || (volumes.length === 1 && /^(正文(?:卷|篇)?|番外(?:卷|篇)?)$/u.test(volumes[0].title))) return [];
  return volumes;
}
