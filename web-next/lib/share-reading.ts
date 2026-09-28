const readingKey='book-share-visits:v2',shownKey='book-share-shown:v1';
let activeBook:string|undefined;
let visits:Record<string,number>={},shown:Record<string,number>={},restored=false;
const validId=(id:string)=>/^[a-f\d]{24}$/i.test(id);
const calendarDay=(time:number)=>{
  const date=new Date(time);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};
function restore() {
  if(restored)return;restored=true;
  try {
    const value=JSON.parse(sessionStorage.getItem(readingKey)||'{}');
    visits=Object.fromEntries(Object.entries(value).filter(([id,time])=>validId(id)&&typeof time==='number'&&Number.isFinite(time)).slice(-100)) as Record<string,number>;
  }catch{}
}
function saveVisits(){try{sessionStorage.setItem(readingKey,JSON.stringify(visits));}catch{}}
export function trackShareReading(bookId:string|undefined,reading:boolean) {
  restore();activeBook=reading?bookId:undefined;
  if(activeBook&&validId(activeBook)){
    delete visits[activeBook];visits[activeBook]=Date.now();
    visits=Object.fromEntries(Object.entries(visits).slice(-100));saveVisits();
  }
}
export function consumeShareReminder(bookId:string) {
  restore();
  if(activeBook||document.visibilityState!=='visible'||!Object.hasOwn(visits,bookId))return false;
  const now=Date.now(),today=calendarDay(now);
  try {
    const value=JSON.parse(localStorage.getItem(shownKey)||'{}');
    if(value&&typeof value==='object')shown={...shown,...value};
  }catch{}
  // A visit is used on return, even if this book has already prompted today.
  delete visits[bookId];saveVisits();
  shown=Object.fromEntries(Object.entries(shown).filter(([id,time])=>validId(id)&&Number.isFinite(time)&&calendarDay(time)===today));
  if(Object.hasOwn(shown,bookId))return false;
  shown[bookId]=now;
  try{localStorage.setItem(shownKey,JSON.stringify(shown));}catch{}
  return true;
}
