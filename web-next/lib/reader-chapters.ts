import type {Chapter} from './api';
import {safeFetch} from './request';

// Parsed text is shared by preloading, page previews and actual chapter entry.
// Both the chapter count and approximate UTF-16 payload size are bounded.
class ChapterCache extends Map<string,Chapter> {
  private bytes=0;
  private cost(chapter:Chapter){return 2*(chapter.content.length+chapter.title.length)+512;}
  override set(id:string,chapter:Chapter){
    this.delete(id);super.set(id,chapter);this.bytes+=this.cost(chapter);
    while(this.size>20 || (this.bytes>6*1024*1024 && this.size>1))this.delete(this.keys().next().value!);
    return this;
  }
  override delete(id:string){const value=super.get(id);if(value)this.bytes-=this.cost(value);return super.delete(id);}
  override clear(){super.clear();this.bytes=0;}
}
export const readerChapterCache=new ChapterCache();
const pending=new Map<string,Promise<Chapter>>();
export async function loadReaderChapter(bookId:string,id:string):Promise<Chapter>{
  const cached=readerChapterCache.get(id);
  if(cached?.bookId===bookId)return cached;
  const key=`${bookId}:${id}`;
  const existing=pending.get(key);if(existing)return existing;
  const request=(async()=>{
    const response=await safeFetch(`/api/chapters/${encodeURIComponent(id)}?navigation=1`,{cache:'no-store'}).catch(()=>{throw Error('网络暂不可用，请重试');});
    if(!response.ok)throw Error(response.status===404?'章节不存在或已下架':'章节加载失败，请重试');
    const chapter:Chapter=await response.json();
    if(chapter.id!==id || chapter.bookId!==bookId || typeof chapter.content!=='string')throw Error('章节数据不匹配');
    readerChapterCache.set(id,chapter);return chapter;
  })();
  pending.set(key,request);
  try{return await request;}finally{pending.delete(key);}
}

type Counts=Record<string,number>;
const countsCache=new Map<string,{value:Counts;time:number}>();
const pendingCounts=new Map<string,Promise<Counts>>();
export const cachedReaderCounts=(id:string)=>countsCache.get(id)?.value;
export function rememberReaderCounts(id:string,value:Counts){
  countsCache.delete(id);countsCache.set(id,{value,time:Date.now()});
  while(countsCache.size>40)countsCache.delete(countsCache.keys().next().value!);
}
export async function loadReaderCounts(id:string,refresh=false):Promise<Counts>{
  const saved=countsCache.get(id);if(!refresh && saved && Date.now()-saved.time<60000)return saved.value;
  const existing=pendingCounts.get(id);if(existing)return existing;
  const request=(async()=>{
    const response=await safeFetch(`/api/chapters/${encodeURIComponent(id)}/paragraph-comments`,{cache:'no-store'});
    if(!response.ok)throw Error('段评暂不可用');
    const data=await response.json();rememberReaderCounts(id,data.counts);return data.counts as Counts;
  })();
  pendingCounts.set(id,request);
  try{return await request;}finally{pendingCounts.delete(id);}
}
