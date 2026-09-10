'use client';

import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {ChevronLeft,Highlighter,MessageCircle} from 'lucide-react';
import Link from './PrefetchLink';
import ParagraphComments from './ParagraphComments';
import {readerParagraphs} from '../../shared/reader-paragraphs.mjs';
import {safeFetch} from '@/lib/request';
import {useStoredState} from '@/lib/useStoredState';
import {useAuth} from '@/contexts/AuthContext';
import type {Book,Chapter} from '@/lib/api';
import './reader-pages.css';

type Paragraph={key:string;text:string};
type BatteryManager=EventTarget & {level:number;charging:boolean};
type Props={
  book:Book; chapter:Chapter; chapterIndex:number; chapterTotal:number|null;
  fontFamily:string; fontSize:number; lineHeight:number; paragraphGap:string;
  theme:{bg:string;text:string;panel:string}; paper:boolean; dark:boolean; pageWidth:number;
  previousId:string|null; nextId:string|null; navigating:boolean; blocked:boolean;
  onChapter:(id:string)=>void; onTools:()=>void; onNearEnd:()=>void;
};

function ReaderClock() {
  const [time,setTime]=useState('');
  const [battery,setBattery]=useState<{level:number;charging:boolean}|null>(null);
  useEffect(()=>{
    const update=()=>setTime(new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}));
    update();const timer=window.setInterval(update,15000);
    return()=>window.clearInterval(timer);
  },[]);
  useEffect(()=>{
    const getBattery=(navigator as Navigator & {getBattery?:()=>Promise<BatteryManager>}).getBattery;
    if (!getBattery) return;
    let active=true,manager:BatteryManager|undefined;
    const update=()=>{if(active && manager)setBattery({level:Math.round(manager.level*100),charging:manager.charging});};
    void getBattery.call(navigator).then(value=>{
      if(!active)return;manager=value;update();manager.addEventListener('levelchange',update);manager.addEventListener('chargingchange',update);
    }).catch(()=>{});
    return()=>{active=false;manager?.removeEventListener('levelchange',update);manager?.removeEventListener('chargingchange',update);};
  },[]);
  return <div className="reader-clock"><time aria-label="当前时间">{time}</time>{battery && <span className="reader-battery" aria-label={`电量${battery.level}%${battery.charging?'，充电中':''}`}>
    <svg viewBox="0 0 23 12" aria-hidden="true"><rect x=".5" y="1" width="19" height="10" rx="2" fill="none" stroke="currentColor"/><path d="M21 4v4" stroke="currentColor" strokeWidth="2"/><rect x="2" y="2.5" width={16*battery.level/100} height="7" rx="1" fill="currentColor"/>{battery.charging && <path d="m11 1-4 6h3l-1 4 5-6h-3l1-4" fill="var(--reader-paper)"/>}</svg><span>{battery.level}%</span>
  </span>}</div>;
}

export default function ReaderPages(props:Props) {
  const {book,chapter,fontFamily,fontSize,lineHeight,paragraphGap,blocked,onChapter,onTools,onNearEnd}=props;
  const {user}=useAuth();
  const title=chapter.title.startsWith('第')?chapter.title:`第${chapter.chapter_number}章 ${chapter.title}`;
  const paragraphs=useMemo(()=>readerParagraphs(chapter.content,chapter.title,chapter.chapter_number),[chapter.content,chapter.title,chapter.chapter_number]);
  const [marks,setMarks]=useStoredState<string[]>(`reader-paragraph-marks:${user?.id || 'guest'}:${chapter.id}`,[],value=>Array.isArray(value)&&value.length<=10000&&value.every(key=>typeof key==='string'&&/^[a-f0-9]{16}-\d+$/.test(key)));
  const [counts,setCounts]=useState<Record<string,number>>({});
  const [countError,setCountError]=useState(false);
  const [page,setPage]=useState(0);
  const [layout,setLayout]=useState({width:0,total:1});
  const [menu,setMenu]=useState<{paragraph:Paragraph;x:number;y:number}|null>(null);
  const [discussion,setDiscussion]=useState<Paragraph|null>(null);
  const [notice,setNotice]=useState('');
  const windowRef=useRef<HTMLDivElement>(null);
  const columns=useRef<HTMLDivElement>(null);
  const menuRef=useRef<HTMLDivElement>(null);
  const currentPage=useRef(0);
  const previousLayout=useRef({width:0,height:0,total:1,typography:''});
  const restored=useRef(false);
  const suppressClickUntil=useRef(0);
  const gesture=useRef<{x:number;y:number;id:number;timer?:ReturnType<typeof setTimeout>;long:boolean}|null>(null);
  const saveKey=`reader-page:${chapter.id}`;
  const controlsBlocked=blocked || !!menu || !!discussion;
  const countChanged=useCallback((key:string,count:number)=>setCounts(previous=>({...previous,[key]:count})),[]);
  const closeDiscussion=useCallback(()=>setDiscussion(null),[]);

  useEffect(()=>{
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previous;};
  },[]);

  useEffect(()=>{
    let active=true;const controller=new AbortController();
    async function refresh() {
      if(document.hidden)return;
      try {
        const response=await safeFetch(`/api/chapters/${chapter.id}/paragraph-comments`,{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw Error('评论暂不可用');
        const data=await response.json();
        if(active){setCounts(data.counts);setCountError(false);}
      } catch {if(active)setCountError(true);}
    }
    void refresh();const timer=window.setInterval(refresh,60000);
    window.addEventListener('focus',refresh);
    return()=>{active=false;controller.abort();window.clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[chapter.id]);

  useLayoutEffect(()=>{
    const viewport=windowRef.current,body=columns.current;
    if(!viewport || !body)return;
    let active=true,frame=0;
    const measure=()=>{
      if(!active)return;
      const width=viewport.clientWidth,height=viewport.clientHeight;
      if(!width || !height)return;
      const total=Math.max(1,Math.ceil((body.scrollWidth+40)/(width+40)));
      const typography=`${fontFamily}/${fontSize}/${lineHeight}/${paragraphGap}`;
      const previous=previousLayout.current;
      let next=currentPage.current;
      if(!restored.current){
        try {const saved=JSON.parse(localStorage.getItem(saveKey)||'null');if(saved && Number.isFinite(saved.fraction))next=Math.round(Math.min(.999,Math.max(0,saved.fraction))*total);} catch { /* Storage may be disabled. */ }
        restored.current=true;
      } else if(previous.width && (previous.width!==width || previous.height!==height || previous.typography!==typography)) {
        next=Math.round(currentPage.current/previous.total*total);
      }
      next=Math.max(0,Math.min(next,total-1));
      previousLayout.current={width,height,total,typography};currentPage.current=next;
      setLayout(old=>old.width===width && old.total===total?old:{width,total});setPage(next);
    };
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
    measure();const observer=new ResizeObserver(schedule);observer.observe(viewport);
    void document.fonts.ready.then(schedule);
    return()=>{active=false;observer.disconnect();cancelAnimationFrame(frame);};
  },[paragraphs,counts,fontFamily,fontSize,lineHeight,paragraphGap,saveKey]);

  useEffect(()=>{
    if(!layout.width)return;
    try{localStorage.setItem(saveKey,JSON.stringify({fraction:page/layout.total}));}catch{ /* Reading remains available without storage. */ }
    if(page>=layout.total-2)onNearEnd();
  },[page,layout,saveKey,onNearEnd]);
  useLayoutEffect(()=>{
    const viewport=windowRef.current,body=columns.current;
    if(!viewport || !body)return;
    const box=viewport.getBoundingClientRect();
    const visible=(element:HTMLElement)=>[...element.getClientRects()].some(rect=>rect.right>box.left+1 && rect.left<box.right-1 && rect.bottom>box.top && rect.top<box.bottom);
    for(const element of body.querySelectorAll<HTMLElement>('[data-paragraph-key],.reader-end')){
      element.inert=!visible(element);
      if(element.matches('[data-paragraph-key]'))element.tabIndex=element.inert?-1:0;
    }
    for(const button of body.querySelectorAll<HTMLButtonElement>('button'))button.tabIndex=visible(button)?0:-1;
    viewport.scrollLeft=0;
  },[page,layout,counts]);
  useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),2200);return()=>window.clearTimeout(timer);},[notice]);

  const turn=useCallback((direction:number)=>{
    if(controlsBlocked || props.navigating)return;
    const target=currentPage.current+direction;
    if(target>=0 && target<layout.total){currentPage.current=target;setPage(target);return;}
    const id=direction<0?props.previousId:props.nextId;
    if(id)onChapter(id);else setNotice(direction<0?'已经是第一章':'已读到最新章节');
  },[controlsBlocked,props.navigating,props.previousId,props.nextId,layout.total,onChapter]);
  useEffect(()=>{
    const handle=(event:KeyboardEvent)=>{
      if(controlsBlocked || (event.target as HTMLElement).closest('input,textarea,[contenteditable=true],[role=dialog],[role=menu]'))return;
      if(event.ctrlKey && ['ArrowLeft','ArrowRight'].includes(event.key)){
        event.preventDefault();const id=event.key==='ArrowLeft'?props.previousId:props.nextId;
        if(id && !props.navigating)onChapter(id);return;
      }
      if(['ArrowRight','PageDown','ArrowLeft','PageUp'].includes(event.key)){event.preventDefault();turn(['ArrowLeft','PageUp'].includes(event.key)?-1:1);}
    };
    window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);
  },[turn,controlsBlocked,props.previousId,props.nextId,props.navigating,onChapter]);
  useEffect(()=>{
    if(!menu)return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    const handle=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setMenu(null);event.preventDefault();}
      if(event.key==='Tab'){event.preventDefault();const buttons=menuRef.current?.querySelectorAll<HTMLButtonElement>('button');if(buttons?.length)buttons[document.activeElement===buttons[0]?1:0]?.focus();}
    };
    document.addEventListener('keydown',handle);return()=>document.removeEventListener('keydown',handle);
  },[menu]);
  useEffect(()=>()=>{if(gesture.current?.timer)clearTimeout(gesture.current.timer);},[]);

  function openMenu(paragraph:Paragraph,x:number,y:number) {
    suppressClickUntil.current=Date.now()+600;
    window.getSelection()?.removeAllRanges();
    setMenu({paragraph,x:Math.max(12,Math.min(x-90,window.innerWidth-216)),y:Math.max(12,Math.min(y-62,window.innerHeight-70))});
  }
  function pointerDown(event:React.PointerEvent) {
    if(controlsBlocked || !event.isPrimary || event.button!==0 || (event.target as HTMLElement).closest('button,a'))return;
    if(gesture.current?.timer)clearTimeout(gesture.current.timer);
    const element=(event.target as HTMLElement).closest<HTMLElement>('[data-paragraph-key]');
    const paragraph=element?paragraphs.find(row=>row.key===element.dataset.paragraphKey):undefined;
    const state={x:event.clientX,y:event.clientY,id:event.pointerId,long:false,timer:undefined as ReturnType<typeof setTimeout>|undefined};
    if(paragraph)state.timer=setTimeout(()=>{state.long=true;openMenu(paragraph,state.x,state.y);},450);
    gesture.current=state;
  }
  function pointerMove(event:React.PointerEvent) {
    const state=gesture.current;
    if(state && Math.hypot(event.clientX-state.x,event.clientY-state.y)>10)clearTimeout(state.timer);
  }
  function pointerUp(event:React.PointerEvent) {
    const state=gesture.current;gesture.current=null;
    if(!state)return;clearTimeout(state.timer);
    if(state.long){suppressClickUntil.current=Date.now()+600;return;}
    const dx=event.clientX-state.x,dy=event.clientY-state.y;
    if(Math.abs(dx)>40 && Math.abs(dx)>Math.abs(dy)){suppressClickUntil.current=Date.now()+400;turn(dx<0?1:-1);}
  }
  function cancelGesture(){if(gesture.current)clearTimeout(gesture.current.timer);gesture.current=null;}
  function click(event:React.MouseEvent) {
    if(controlsBlocked || Date.now()<suppressClickUntil.current || (event.target as HTMLElement).closest('button,a'))return;
    const box=windowRef.current!.getBoundingClientRect(),fraction=(event.clientX-box.left)/box.width;
    if(fraction<.3)turn(-1);else if(fraction>.7)turn(1);else onTools();
  }
  function toggleMark() {
    if(!menu)return;
    const marked=marks.includes(menu.paragraph.key);
    setMarks(previous=>marked?previous.filter(key=>key!==menu.paragraph.key):[...previous,menu.paragraph.key]);
    setMenu(null);setNotice(marked?'已取消标记':'已标记，保存在当前浏览器');
  }
  const totalChapters=props.chapterTotal;
  const progress=totalChapters && props.chapterIndex>=0?Math.min(100,(props.chapterIndex+(page+1)/layout.total)/totalChapters*100).toFixed(1)+'%':'—';
  const style={'--reader-paper':props.theme.bg,'--reader-ink':props.theme.text,'--reader-panel':props.theme.panel,'--reader-width':`${props.pageWidth}px`,'--reader-paragraph-gap':paragraphGap} as CSSProperties;

  return <div className="reader-pages-root" data-dark={props.dark} style={style}>
    <section className="reader-frame" data-paper={props.paper && !props.dark} aria-label="章节阅读">
      <header className="reader-status-top"><Link className="reader-return" href={`/book/${book.id}`} aria-label={`返回书籍详情：${page===0?book.title:title}`}><ChevronLeft size={18}/><span>{page===0?book.title:title}</span></Link><ReaderClock/></header>
      <div ref={windowRef} className="reader-page-window" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelGesture} onClick={click}>
        <div ref={columns} className="reader-columns" style={{fontFamily,fontSize:`${fontSize}px`,lineHeight,transform:`translateX(${-page*(layout.width+40)}px)`}}>
          <h1>{title}</h1>
          {paragraphs.map(paragraph=><p key={paragraph.key} className="reader-paragraph" data-paragraph-key={paragraph.key} data-marked={marks.includes(paragraph.key)} data-selected={menu?.paragraph.key===paragraph.key} tabIndex={0}
            onContextMenu={event=>{event.preventDefault();if(!blocked)openMenu(paragraph,event.clientX,event.clientY);}}
            onKeyDown={event=>{if(event.key==='Enter' || (event.shiftKey && event.key==='F10')){event.preventDefault();const rect=event.currentTarget.getClientRects()[0];openMenu(paragraph,rect.x+80,rect.y+40);}}}>
            <span className="reader-paragraph-text">{paragraph.text}</span>
            {!!counts[paragraph.key] && <button className="paragraph-bubble" data-hot={counts[paragraph.key]>10} aria-label={`${counts[paragraph.key]}条段落评论`} onClick={event=>{event.stopPropagation();setDiscussion(paragraph);}}>{counts[paragraph.key]}</button>}
          </p>)}
          <div className="reader-end"><p>{props.nextId?'本章完':'已读到最新章节'}</p><button disabled={props.navigating || !props.nextId} onClick={()=>props.nextId && onChapter(props.nextId)}>{props.navigating?'加载中…':props.nextId?'下一章':'等待更新'}</button></div>
        </div>
      </div>
      <footer className="reader-status-bottom"><div className="reader-progress" aria-label="阅读进度"><span data-reader-page>{page+1}/{layout.total}</span><span>{progress}</span></div><div className="reader-page-controls"><button aria-label="上一页" disabled={props.navigating || (page===0 && !props.previousId)} onClick={()=>turn(-1)}>上一页</button><button onClick={onTools} aria-label="阅读菜单">•••</button><button aria-label="下一页" disabled={props.navigating || (page===layout.total-1 && !props.nextId)} onClick={()=>turn(1)}>下一页</button></div></footer>
      {(notice || countError) && <div className="reader-notice" role="status">{notice || '段评暂不可用，正文可继续阅读'}</div>}
    </section>
    {menu && <div className="paragraph-menu-backdrop" onClick={()=>{if(Date.now()>=suppressClickUntil.current)setMenu(null);}}><div ref={menuRef} role="menu" aria-label="段落操作" className="paragraph-menu" style={{left:menu.x,top:menu.y}} onClick={event=>event.stopPropagation()}><button role="menuitem" onClick={()=>{setDiscussion(menu.paragraph);setMenu(null);}}><MessageCircle size={16}/>评论</button><button role="menuitem" onClick={toggleMark}><Highlighter size={16}/>{marks.includes(menu.paragraph.key)?'取消标记':'标记'}</button></div></div>}
    {discussion && <ParagraphComments key={discussion.key} chapterId={chapter.id} paragraph={discussion} onClose={closeDiscussion} onCount={countChanged}/>}
  </div>;
}
