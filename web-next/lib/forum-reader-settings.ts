export const FORUM_DEFAULT_FONT_SIZE = 18;
const key = 'forum_reader_settings_v1';
export function readForumFontSize() {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    // The old article reader wrote its 17px default on every visit. Only keep
    // 17px when it is an explicit choice made by the updated reader.
    if (Number.isFinite(value.fontSize) && value.fontSize >= 14 && value.fontSize <= 24 && (value.fontSize !== 17 || value.userSelected)) return value.fontSize as number;
  } catch { /* Use the default if settings are unavailable. */ }
  return FORUM_DEFAULT_FONT_SIZE;
}
export function saveForumFontSize(fontSize:number) {
  try {localStorage.setItem(key,JSON.stringify({fontSize,userSelected:true}));} catch { /* Keep the current session usable. */ }
}
