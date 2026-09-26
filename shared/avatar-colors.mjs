export const AVATAR_COLORS = [
  {id:'coral',name:'珊瑚',background:'#fae5df',foreground:'#a64143',border:'#eacfc7'},
  {id:'rose',name:'玫瑰',background:'#f8e1ea',foreground:'#9b365e',border:'#ebc4d5'},
  {id:'peach',name:'蜜桃',background:'#ffe7d5',foreground:'#995022',border:'#eecbad'},
  {id:'amber',name:'琥珀',background:'#f8ebc6',foreground:'#84600c',border:'#e6d39d'},
  {id:'olive',name:'橄榄',background:'#e9edce',foreground:'#5b6624',border:'#d2d9a9'},
  {id:'sage',name:'鼠尾草',background:'#e2ecda',foreground:'#466431',border:'#c7d8b8'},
  {id:'mint',name:'薄荷',background:'#d9f0e4',foreground:'#28704f',border:'#b8dccc'},
  {id:'teal',name:'青碧',background:'#d8efed',foreground:'#266b68',border:'#b9dcd8'},
  {id:'cyan',name:'湖蓝',background:'#dceff5',foreground:'#2a647a',border:'#c0dfe9'},
  {id:'sky',name:'晴空',background:'#dfedfc',foreground:'#356698',border:'#c3daf2'},
  {id:'indigo',name:'靛蓝',background:'#e4e8fa',foreground:'#4c5599',border:'#ccd2ef'},
  {id:'violet',name:'紫藤',background:'#ede3fa',foreground:'#765098',border:'#dbcaef'},
  {id:'lilac',name:'丁香',background:'#f2e3f2',foreground:'#88528b',border:'#e3cae3'},
  {id:'cocoa',name:'可可',background:'#eee2db',foreground:'#795744',border:'#dccabe'},
  {id:'slate',name:'青灰',background:'#e4e9ee',foreground:'#4e6275',border:'#cbd5df'},
  {id:'sand',name:'沙色',background:'#f0e9de',foreground:'#7a6549',border:'#dfd1bd'},
];
export const AVATAR_COLOR_IDS=AVATAR_COLORS.map(color=>color.id);
export function resolveAvatarColor(identity,saved){
  const selected=AVATAR_COLORS.find(color=>color.id===saved);
  if(selected)return selected;
  const hash=Array.from(identity||'guest').reduce((value,char)=>(value*31+char.codePointAt(0))>>>0,0);
  return AVATAR_COLORS[hash%AVATAR_COLORS.length];
}
