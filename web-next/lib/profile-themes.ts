export const PROFILE_THEMES = [
  {id: 'apricot', name: '暖杏', description: '暖阳与书页'},
  {id: 'sage', name: '青竹', description: '绿意与留白'},
  {id: 'mist', name: '雾蓝', description: '远山与微风'},
  {id: 'rose', name: '豆沙', description: '花影与柔光'},
] as const;

export type ProfileTheme = typeof PROFILE_THEMES[number]['id'];

export function resolveProfileTheme(userId: string, saved?: string): ProfileTheme {
  if (PROFILE_THEMES.some(theme => theme.id === saved)) return saved as ProfileTheme;
  // Older accounts get a stable starting style without a database migration.
  const hash = Array.from(userId).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  return PROFILE_THEMES[hash % PROFILE_THEMES.length].id;
}
