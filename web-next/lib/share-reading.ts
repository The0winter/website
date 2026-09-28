const readingKey='book-share-reading:v1',shownKey='book-share-shown:v1';
export const shareReadingThreshold=30*60*1000;
const day=24*60*60*1000;
type Reading={ms:number;updated:number};
let activeBook:string|undefined,started:number|undefined;
let records:Record<string,Reading>={},shown:Record<string,number>={},restored=false;
function restore() {
  if(restored)return;restored=true;
  try {
    const value=JSON.parse(sessionStorage.getItem(readingKey)||'{}');
    for(const [id,row] of Object.entries(value)) {
      const r=row as Reading;
      if(/^[a-f\d]{24}$/i.test(id)&&Number.isFinite(r?.ms)&&r.ms>=0&&Number.isFinite(r.updated)&&Date.now()-r.updated<day)records[id]={ms:Math.min(r.ms,shareReadingThreshold),updated:r.updated};
    }
  }catch{}
  try {const value=JSON.parse(localStorage.getItem(shownKey)||'{}');if(value&&typeof value==='object')shown=value;}catch{}
}
function checkpoint() {
  if(activeBook&&started!==undefined) {
    const now=Date.now(),row=records[activeBook]||{ms:0,updated:now};
    records[activeBook]={ms:Math.min(shareReadingThreshold,row.ms+Math.max(0,now-started)),updated:now};
    records=Object.fromEntries(Object.entries(records).filter(([,r])=>now-r.updated<day).slice(-40));
    try {sessionStorage.setItem(readingKey,JSON.stringify(records));}catch{}
  }
  started=undefined;
}
function resume(){if(activeBook&&document.visibilityState==='visible')started=Date.now();}
export function trackShareReading(bookId:string|undefined,reading:boolean) {
  restore();checkpoint();activeBook=reading?bookId:undefined;resume();
}
export function installShareReading() {
  const visibility=()=>{checkpoint();resume();};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',checkpoint);window.addEventListener('pageshow',visibility);
  const timer=setInterval(visibility,15000);
  return()=>{checkpoint();clearInterval(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',checkpoint);window.removeEventListener('pageshow',visibility);};
}
export function consumeShareReminder(bookId:string) {
  restore();
  if(activeBook||document.visibilityState!=='visible'||(records[bookId]?.ms||0)<shareReadingThreshold)return false;
  const now=Date.now();
  try {const value=JSON.parse(localStorage.getItem(shownKey)||'{}');if(value&&typeof value==='object')shown={...shown,...value};}catch{}
  if(now-(Number(shown.all)||0)<day||now-(Number(shown[bookId])||0)<7*day)return false;
  shown=Object.fromEntries(Object.entries(shown).filter(([,time])=>Number.isFinite(time)&&now-time<7*day).slice(-40));
  shown.all=now;shown[bookId]=now;records[bookId]={ms:0,updated:now};
  try{localStorage.setItem(shownKey,JSON.stringify(shown));sessionStorage.setItem(readingKey,JSON.stringify(records));}catch{}
  return true;
}
