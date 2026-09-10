/** Use the largest elapsed unit; short updates stay accurate without showing a date. */
export function formatRelativeUpdate(updatedAt: string | undefined, now = Date.now()): string {
  const timestamp = Date.parse(updatedAt ?? '');
  if (!Number.isFinite(timestamp)) return '更新时间未知';

  const hours = Math.max(0, (now - timestamp) / 3_600_000);
  if (hours < 1) return '1小时内更新';
  if (hours < 24) return `${Math.floor(hours)}小时前更新`;
  const days = hours / 24;
  if (days < 30) return `${Math.floor(days)}天前更新`;
  if (days < 365) return `${Math.floor(days / 30)}个月前更新`;
  return `${Math.floor(days / 365)}年前更新`;
}
