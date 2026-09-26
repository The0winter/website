export type AvatarColorId='coral'|'rose'|'peach'|'amber'|'olive'|'sage'|'mint'|'teal'|'cyan'|'sky'|'indigo'|'violet'|'lilac'|'cocoa'|'slate'|'sand';
export type AvatarColor={id:AvatarColorId;name:string;background:string;foreground:string;border:string};
export const AVATAR_COLORS:AvatarColor[];
export const AVATAR_COLOR_IDS:AvatarColorId[];
export function resolveAvatarColor(identity:string,saved?:string):AvatarColor;
