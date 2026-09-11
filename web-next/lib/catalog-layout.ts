import type {CatalogVolume} from './book-catalog';

export function catalogLayout(volumes: readonly CatalogVolume[], expanded: ReadonlySet<string>, columns: number) {
  let total = 0;
  const groups = volumes.map(volume => {
    const rows = expanded.has(volume.id) ? Math.ceil(volume.count / columns) : 0;
    const group = {volume, header: total, rows}; total += 1 + rows; return group;
  });
  const at = (index: number) => {
    let low = 0, high = groups.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (groups[middle].header <= index) low = middle; else high = middle - 1;
    }
    const group = groups[low];
    return {group, chapterStart: index === group.header ? null : group.volume.start + (index - group.header - 1) * columns};
  };
  const chapter = (index: number) => {
    const group = groups.find(({volume}) => index >= volume.start && index < volume.start + volume.count);
    return group ? group.header + (group.rows ? 1 + Math.floor((index - group.volume.start) / columns) : 0) : 0;
  };
  return {groups, total, at, chapter};
}
