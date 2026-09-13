import type {CatalogVolume} from './book-catalog';

export function catalogLayout(volumes: readonly CatalogVolume[], expanded: ReadonlySet<string>, columns: number) {
  let total = 0;
  const groups = volumes.map(volume => {
    const heading = volume.title ? 1 : 0;
    const rows = !heading || expanded.has(volume.id) ? Math.ceil(volume.count / columns) : 0;
    const group = {volume, header: total, start: total + heading, rows}; total += heading + rows; return group;
  });
  const at = (index: number) => {
    let low = 0, high = groups.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (groups[middle].header <= index) low = middle; else high = middle - 1;
    }
    const group = groups[low];
    return {group, chapterStart: index < group.start ? null : group.volume.start + (index - group.start) * columns};
  };
  const chapter = (index: number) => {
    const group = groups.find(({volume}) => index >= volume.start && index < volume.start + volume.count);
    return group ? group.rows ? group.start + Math.floor((index - group.volume.start) / columns) : group.header : 0;
  };
  return {groups, total, at, chapter};
}
