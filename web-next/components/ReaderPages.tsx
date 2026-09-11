'use client';

import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore,type CSSProperties} from 'react';
import {ChevronLeft,Highlighter,MessageCircle} from 'lucide-react';
import Link from './PrefetchLink';
import ParagraphComments from './ParagraphComments';
import {readerParagraphs} from '../../shared/reader-paragraphs.mjs';
import {cachedReaderCounts,loadReaderCounts,rememberReaderCounts} from '@/lib/reader-chapters';
import {fillReaderPreview,fitReaderColumnHeight,readerChapterTitle,readerColumnLayout} from '@/lib/reader-layout';
import {useStoredState} from '@/lib/useStoredState';
import {useAuth} from '@/contexts/AuthContext';
import type {Book,Chapter} from '@/lib/api';
import {READER_TURN_DURATION_MS,useReaderPageTurn,type ReaderTurnMode} from './useReaderPageTurn';
import './reader-pages.css';

type Paragraph={key:string;text:string};
const subscribeHydration=()=>()=>{};
const clientReady=()=>true;
const serverReady=()=>false;
type Props={
  book:Book; chapter:Chapter; chapterIndex:number; chapterTotal:number|null;
  fontFamily:string; fontSize:number; lineHeight:number; paragraphGap:string;
  theme:{bg:string;text:string;panel:string}; paper:boolean; dark:boolean; pageWidth:number;
  previousId:string|null; nextId:string|null; navigating:boolean; blocked:boolean;
  previousChapter?:Chapter; nextChapter?:Chapter;
  turnMode:ReaderTurnMode; toolsVisible:boolean;
  onChapter:(id:string)=>void; onTools:()=>void; onHideTools:()=>void; onNearEnd:()=>void;
};

export default function ReaderPages(props:Props) {
  const {book,chapter,fontFamily,fontSize,lineHeight,paragraphGap,blocked,turnMode,onChapter,onTools,onHideTools,onNearEnd}=props;
  const scrolling=turnMode==='scroll';
  const hydrated=useSyncExternalStore(subscribeHydration,clientReady,serverReady);
  const {user}=useAuth();
  const title=readerChapterTitle(chapter);
  const paragraphs=useMemo(()=>readerParagraphs(chapter.content,chapter.title,chapter.chapter_number),[chapter.content,chapter.title,chapter.chapter_number]);
  const [marks,setMarks]=useStoredState<string[]>(`reader-paragraph-marks:${user?.id || 'guest'}:${chapter.id}`,[],value=>Array.isArray(value)&&value.length<=10000&&value.every(key=>typeof key==='string'&&/^[a-f0-9]{16}-\d+$/.test(key)));
  const [counts,setCounts]=useState<Record<string,number>>(()=>cachedReaderCounts(chapter.id) || {});
  const [countError,setCountError]=useState(false);
  const [page,setPage]=useState(0);
  const [layout,setLayout]=useState({width:0,height:0,total:1});
  const [menu,setMenu]=useState<{paragraph:Paragraph;x:number;y:number}|null>(null);
  const [discussion,setDiscussion]=useState<Paragraph|null>(null);
  const [notice,setNotice]=useState('');
  const menuRef=useRef<HTMLDivElement>(null);
  const currentPage=useRef(0);
  const fraction=useRef(0);
  const previousLayout=useRef({width:0,height:0,total:1,typography:'',mode:turnMode});
  const restored=useRef(false);
  const suppressClickUntil=useRef(0);
  const gesture=useRef<{x:number;y:number;id:number;time:number;last:number;lastTime:number;velocity:number;timer?:ReturnType<typeof setTimeout>;long:boolean;moved:boolean;dragging:boolean}|null>(null);
  const touchEdge=useRef<{x:number;y:number;top:boolean;bottom:boolean}|null>(null);
  const wheelEdge=useRef<{last:number;direction:number}>({last:0,direction:0});
  const measureHost=useRef<HTMLDivElement>(null);
  const prepared=useRef<{previous?:HTMLElement;next?:HTMLElement}>({});
  const saveKey=`reader-page:${chapter.id}`;
  const controlsBlocked=blocked || !!menu || !!discussion;
  const countChanged=useCallback((key:string,count:number)=>setCounts(previous=>{const value={...previous,[key]:count};rememberReaderCounts(chapter.id,value);return value;}),[chapter.id]);
  const closeDiscussion=useCallback(()=>setDiscussion(null),[]);
  const commitPage=useCallback((target:number)=>{
    if(target<0 || target===Infinity){
      const id=target<0?props.previousId:props.nextId;
      if(id){try{sessionStorage.setItem(`reader-entry:${id}`,target<0?'end':'start');}catch{}onChapter(id);}
      return;
    }
    currentPage.current=target;setPage(target);
  },[props.previousId,props.nextId,onChapter]);
  const {viewport:windowRef,textWindow,columns,surface,preview,begin:beginTurn,drag:dragTurn,finish:finishTurn,cancel:cancelTurn,busy:turnBusy,settling:turnSettling}=useReaderPageTurn({mode:turnMode,onCommit:commitPage});

  useEffect(()=>{
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previous;};
  },[]);

  useEffect(()=>{
    let active=true;
    async function refresh(force=false) {
      if(document.hidden)return;
      try {
        const value=await loadReaderCounts(chapter.id,force);
        if(active){setCounts(value);setCountError(false);}
      } catch {if(active)setCountError(true);}
    }
    const update=()=>{void refresh(true);};
    void refresh();const timer=window.setInterval(update,60000);
    window.addEventListener('focus',update);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',update);};
  },[chapter.id]);

  useLayoutEffect(()=>{
    // Wait for stored reader settings before measuring or rewriting saved
    // progress. The server's default paging mode may differ from this browser.
    if(!hydrated)return;
    const viewport=textWindow.current,body=columns.current;
    if(!viewport || !body)return;
    let active=true,frame=0;
    const measure=()=>{
      if(!active)return;
      const height=viewport.getBoundingClientRect().height;
      if(scrolling)body.style.height='';else fitReaderColumnHeight(body,height);
      const {width,total:columnTotal}=readerColumnLayout(body);
      if(!width || !height)return;
      const total=Math.max(1,scrolling?Math.ceil(body.scrollHeight/height):columnTotal);
      const typography=`${fontFamily}/${fontSize}/${lineHeight}/${paragraphGap}`;
      const previous=previousLayout.current;
      let next=currentPage.current,position=fraction.current;
      let entry:string|null=null;
      try{entry=sessionStorage.getItem(`reader-entry:${chapter.id}`);}catch{}
      if(!restored.current || entry){
        try {
          const saved=JSON.parse(localStorage.getItem(saveKey)||'null');
          if(!restored.current && saved && Number.isFinite(saved.fraction))position=Math.min(.999,Math.max(0,saved.fraction));
          if(entry){position=entry==='end'?.999:0;sessionStorage.removeItem(`reader-entry:${chapter.id}`);}
        } catch { /* Storage may be disabled. */ }
        next=Math.round(position*total);
        restored.current=true;
      } else if(previous.width && (previous.width!==width || previous.height!==height || previous.total!==total || previous.typography!==typography || previous.mode!==turnMode)) {
        if(gesture.current){clearTimeout(gesture.current.timer);gesture.current=null;suppressClickUntil.current=Date.now()+READER_TURN_DURATION_MS;}
        cancelTurn();next=Math.round(position*total);
      }
      next=Math.max(0,Math.min(next,total-1));
      if(scrolling){
        viewport.scrollTop=Math.min(viewport.scrollHeight-height,position*body.scrollHeight);
        next=viewport.scrollTop>=viewport.scrollHeight-height-1?total-1:Math.floor(viewport.scrollTop/height);
        fraction.current=viewport.scrollTop/body.scrollHeight;
      }else{viewport.scrollTop=0;fraction.current=next/total;}
      previousLayout.current={width,height,total,typography,mode:turnMode};currentPage.current=next;
      setLayout(old=>old.width===width && old.height===height && old.total===total?old:{width,height,total});setPage(next);
    };
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
    measure();const observer=new ResizeObserver(schedule);observer.observe(viewport);
    void document.fonts.ready.then(schedule);
    return()=>{active=false;observer.disconnect();cancelAnimationFrame(frame);};
  },[paragraphs,counts,fontFamily,fontSize,lineHeight,paragraphGap,saveKey,scrolling,turnMode,chapter.id,cancelTurn,columns,textWindow,hydrated]);

  useEffect(()=>{
    if(!layout.width)return;
    if(!scrolling)fraction.current=page/layout.total;
    try{localStorage.setItem(saveKey,JSON.stringify({fraction:fraction.current}));}catch{ /* Reading remains available without storage. */ }
    if(page>=layout.total-2)onNearEnd();
  },[page,layout,saveKey,onNearEnd,scrolling]);
  useLayoutEffect(()=>{
    const viewport=textWindow.current,body=columns.current;
    if(!viewport || !body)return;
    const box=viewport.getBoundingClientRect();
    const visible=(element:HTMLElement)=>[...element.getClientRects()].some(rect=>rect.right>box.left+1 && rect.left<box.right-1 && rect.bottom>box.top && rect.top<box.bottom);
    for(const element of body.querySelectorAll<HTMLElement>('[data-paragraph-key]')){
      element.inert=!scrolling && !visible(element);
      if(element.matches('[data-paragraph-key]'))element.tabIndex=element.inert?-1:0;
    }
    for(const button of body.querySelectorAll<HTMLButtonElement>('button'))button.tabIndex=scrolling || visible(button)?0:-1;
    viewport.scrollLeft=0;
  },[page,layout,counts,scrolling,columns,textWindow]);
  useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),2200);return()=>window.clearTimeout(timer);},[notice]);

  const progressAt=useCallback((index:number,part:number)=>props.chapterTotal && index>=0?Math.min(100,(index+part)/props.chapterTotal*100).toFixed(1)+'%':'—',[props.chapterTotal]);
  const makeAdjacentSheet=useCallback((direction:number)=>{
    const target=direction<0?props.previousChapter:props.nextChapter;
    const source=surface.current,host=measureHost.current;
    if(!target || !source || !host || !layout.width || !layout.height || scrolling)return null;
    const sheet=source.cloneNode(true) as HTMLElement;
    sheet.style.transform='';sheet.style.zIndex='';sheet.removeAttribute('data-moving');
    const body=sheet.querySelector<HTMLElement>('.reader-columns')!;
    body.style.transform='none';
    let targetMarks:string[]=[];
    try{const value=JSON.parse(localStorage.getItem(`reader-paragraph-marks:${user?.id || 'guest'}:${target.id}`)||'[]');if(Array.isArray(value))targetMarks=value;}catch{}
    fillReaderPreview(body,target,cachedReaderCounts(target.id) || {},targetMarks);
    host.replaceChildren(sheet);
    fitReaderColumnHeight(body,sheet.querySelector('.reader-text-window')!.getBoundingClientRect().height);
    const targetLayout=readerColumnLayout(body),targetPage=direction<0?targetLayout.total-1:0;
    body.style.transform=`translateX(${-targetPage*targetLayout.step}px)`;
    sheet.querySelector('[data-reader-page]')!.textContent=`${targetPage+1}/${targetLayout.total}`;
    sheet.querySelector('.reader-progress span:last-child')!.textContent=progressAt(props.chapterIndex+direction,(targetPage+1)/targetLayout.total);
    sheet.remove();return sheet;
  },[props.previousChapter,props.nextChapter,props.chapterIndex,layout.width,layout.height,scrolling,user?.id,surface,progressAt]);
  useLayoutEffect(()=>{
    prepared.current={};
    // Arrange just the adjacent chapters after their parsed text arrives.
    // The inert measuring sheet never mounts a reader or fires reading effects.
    const timer=window.setTimeout(()=>{
      prepared.current={previous:makeAdjacentSheet(-1) || undefined,next:makeAdjacentSheet(1) || undefined};
    },50);
    return()=>{window.clearTimeout(timer);prepared.current={};};
  },[makeAdjacentSheet,fontFamily,fontSize,lineHeight,paragraphGap,props.theme.bg]);
  const beginPageTurn=useCallback((target:number,direction:number)=>{
    if(target>=0 && target<layout.total)return beginTurn(target,direction,undefined,progressAt(props.chapterIndex,(target+1)/layout.total));
    const side=direction<0?'previous':'next';
    const sheet=prepared.current[side] || makeAdjacentSheet(direction);
    if(!sheet)return false;
    prepared.current[side]=sheet;
    return beginTurn(direction<0?-1:Infinity,direction,sheet);
  },[layout.total,beginTurn,progressAt,props.chapterIndex,makeAdjacentSheet]);

  const adjacentChapter=useCallback((direction:number,entry=direction<0?'end':'start')=>{
    if(controlsBlocked || props.navigating)return;
    const id=direction<0?props.previousId:props.nextId;
    if(id){
      try{sessionStorage.setItem(`reader-entry:${id}`,entry);}catch{}
      onHideTools();onChapter(id);
    }else setNotice(direction<0?'已经是第一章':'已读到最新章节');
  },[controlsBlocked,props.navigating,props.previousId,props.nextId,onChapter,onHideTools]);
  const turn=useCallback((direction:number)=>{
    if(controlsBlocked || props.navigating || turnBusy())return;
    onHideTools();
    const viewport=textWindow.current;
    if(scrolling && viewport){
      if(direction<0?viewport.scrollTop<=1:viewport.scrollTop>=viewport.scrollHeight-viewport.clientHeight-1)adjacentChapter(direction);
      else viewport.scrollBy({top:direction*viewport.clientHeight*.9,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
      return;
    }
    const target=currentPage.current+direction;
    if(beginPageTurn(target,direction)){finishTurn(true);return;}
    adjacentChapter(direction);
  },[controlsBlocked,props.navigating,scrolling,turnBusy,onHideTools,adjacentChapter,beginPageTurn,finishTurn,textWindow]);
  useEffect(()=>{
    const handle=(event:KeyboardEvent)=>{
      if(controlsBlocked || (event.target as HTMLElement).closest('input,textarea,[contenteditable=true],[role=dialog],[role=menu]'))return;
      if(event.key==='Escape'){onHideTools();return;}
      if(event.key==='m' || event.key==='M'){event.preventDefault();onTools();return;}
      if(event.ctrlKey && ['ArrowLeft','ArrowRight'].includes(event.key)){
        event.preventDefault();adjacentChapter(event.key==='ArrowLeft'?-1:1,'start');return;
      }
      if(['ArrowRight','PageDown','ArrowLeft','PageUp',...(scrolling?[]:['ArrowUp','ArrowDown'])].includes(event.key)){event.preventDefault();turn(['ArrowLeft','PageUp','ArrowUp'].includes(event.key)?-1:1);}
    };
    window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);
  },[turn,controlsBlocked,scrolling,adjacentChapter,onHideTools,onTools]);
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
    if(turnBusy())return;
    suppressClickUntil.current=Date.now()+READER_TURN_DURATION_MS;
    onHideTools();
    window.getSelection()?.removeAllRanges();
    setMenu({paragraph,x:Math.max(12,Math.min(x-90,window.innerWidth-216)),y:Math.max(12,Math.min(y-62,window.innerHeight-70))});
  }
  function pointerDown(event:React.PointerEvent) {
    if(!event.isPrimary){cancelGesture();return;}
    if(controlsBlocked || props.navigating || turnBusy() || event.button!==0 || (event.target as HTMLElement).closest('button,a'))return;
    if(gesture.current?.timer)clearTimeout(gesture.current.timer);
    const element=(event.target as HTMLElement).closest<HTMLElement>('[data-paragraph-key]');
    const paragraph=element?paragraphs.find(row=>row.key===element.dataset.paragraphKey):undefined;
    const state={x:event.clientX,y:event.clientY,id:event.pointerId,time:performance.now(),last:turnMode==='vertical'?event.clientY:event.clientX,lastTime:performance.now(),velocity:0,long:false,moved:false,dragging:false,timer:undefined as ReturnType<typeof setTimeout>|undefined};
    if(paragraph)state.timer=setTimeout(()=>{state.long=true;openMenu(paragraph,state.x,state.y);},450);
    gesture.current=state;
  }
  function pointerMove(event:React.PointerEvent) {
    const state=gesture.current;
    if(!state || state.id!==event.pointerId || state.long)return;
    const dx=event.clientX-state.x,dy=event.clientY-state.y;
    if(Math.hypot(dx,dy)>8){clearTimeout(state.timer);state.moved=true;}
    if(scrolling || !state.moved)return;
    const distance=turnMode==='vertical'?dy:dx,cross=turnMode==='vertical'?dx:dy;
    if(!state.dragging && Math.abs(distance)<=Math.abs(cross))return;
    if(!state.dragging){state.dragging=true;event.currentTarget.setPointerCapture(event.pointerId);onHideTools();}
    const coordinate=turnMode==='vertical'?event.clientY:event.clientX,now=performance.now();
    state.velocity=(coordinate-state.last)/Math.max(1,now-state.lastTime);state.last=coordinate;state.lastTime=now;
    const direction=distance<0?1:-1,target=currentPage.current+direction;
    if(beginPageTurn(target,direction))dragTurn(distance);else cancelTurn();
  }
  function pointerUp(event:React.PointerEvent) {
    const state=gesture.current;gesture.current=null;
    if(!state)return;clearTimeout(state.timer);
    if(state.long || state.moved)suppressClickUntil.current=Date.now()+READER_TURN_DURATION_MS;
    if(state.long || !state.dragging)return;
    const distance=turnMode==='vertical'?event.clientY-state.y:event.clientX-state.x;
    const extent=turnMode==='vertical'?layout.height:layout.width;
    const fast=performance.now()-state.lastTime<100 && Math.abs(state.velocity)>.45 && state.velocity*distance>0;
    const commit=Math.abs(distance)>extent*.2 || (Math.abs(distance)>24 && fast);
    if(turnBusy())finishTurn(commit);
    else if(commit)adjacentChapter(distance<0?1:-1);
  }
  function cancelGesture(){
    if(gesture.current){clearTimeout(gesture.current.timer);if(gesture.current.moved)suppressClickUntil.current=Date.now()+READER_TURN_DURATION_MS;}
    gesture.current=null;
    if(!turnSettling())finishTurn(false);
  }
  function click(event:React.MouseEvent) {
    if(controlsBlocked || turnBusy() || Date.now()<suppressClickUntil.current || (event.target as HTMLElement).closest('button,a'))return;
    if(props.toolsVisible || scrolling){onTools();return;}
    const box=windowRef.current!.getBoundingClientRect();
    const position=turnMode==='vertical'?(event.clientY-box.top)/box.height:(event.clientX-box.left)/box.width;
    if(position<.3)turn(-1);else if(position>.7)turn(1);else onTools();
  }
  function onScroll() {
    const viewport=textWindow.current,body=columns.current;
    if(!scrolling || !viewport || !body || !layout.height)return;
    const next=viewport.scrollTop>=viewport.scrollHeight-viewport.clientHeight-1?layout.total-1:Math.floor(viewport.scrollTop/layout.height);
    fraction.current=viewport.scrollTop/body.scrollHeight;
    currentPage.current=Math.max(0,Math.min(next,layout.total-1));setPage(currentPage.current);
    // Persist sub-page offsets too, so a refresh in scrolling mode stays put.
    try{localStorage.setItem(saveKey,JSON.stringify({fraction:fraction.current}));}catch{}
    if(props.toolsVisible && !blocked)onHideTools();
  }
  function touchStart(event:React.TouchEvent) {
    const viewport=textWindow.current;
    if(!scrolling || controlsBlocked || event.touches.length!==1 || !viewport || (event.target as HTMLElement).closest('button,a')){touchEdge.current=null;return;}
    touchEdge.current={x:event.touches[0].clientX,y:event.touches[0].clientY,top:viewport.scrollTop<=1,bottom:viewport.scrollTop>=viewport.scrollHeight-viewport.clientHeight-1};
  }
  function touchEnd(event:React.TouchEvent) {
    const start=touchEdge.current;touchEdge.current=null;
    if(!start || event.touches.length || !event.changedTouches[0] || controlsBlocked)return;
    const dy=event.changedTouches[0].clientY-start.y,dx=event.changedTouches[0].clientX-start.x;
    if(Math.abs(dy)>80 && Math.abs(dy)>Math.abs(dx) && (dy<0?start.bottom:start.top)){
      suppressClickUntil.current=Date.now()+READER_TURN_DURATION_MS;adjacentChapter(dy<0?1:-1);
    }
  }
  function wheel(event:React.WheelEvent){
    const viewport=textWindow.current;
    if(!scrolling || !viewport || controlsBlocked)return;
    const now=performance.now(),state=wheelEdge.current;
    if(now-state.last>180)state.direction=viewport.scrollTop<=1?-1:viewport.scrollTop>=viewport.scrollHeight-viewport.clientHeight-1?1:0;
    state.last=now;
    if(state.direction && event.deltaY*state.direction>25){const direction=state.direction;state.direction=0;adjacentChapter(direction);}
  }
  function toggleMark() {
    if(!menu)return;
    const marked=marks.includes(menu.paragraph.key);
    setMarks(previous=>marked?previous.filter(key=>key!==menu.paragraph.key):[...previous,menu.paragraph.key]);
    setMenu(null);setNotice(marked?'已取消标记':'已标记，保存在当前浏览器');
  }
  const progress=progressAt(props.chapterIndex,(page+1)/layout.total);
  const style={'--reader-paper':props.theme.bg,'--reader-ink':props.theme.text,'--reader-panel':props.theme.panel,'--reader-width':`${props.pageWidth}px`,'--reader-paragraph-gap':paragraphGap} as CSSProperties;

  return <div className="reader-pages-root" data-dark={props.dark} data-mode={turnMode} data-reader-ready={layout.width>0} data-reader-chapter={chapter.id} data-reader-previous={props.previousChapter?.id || ''} data-reader-next={props.nextChapter?.id || ''} style={style}>
    <section className="reader-frame" data-paper={props.paper && !props.dark} aria-label="章节阅读">
      <header className="reader-status-top" data-open={props.toolsVisible} inert={!props.toolsVisible} aria-hidden={!props.toolsVisible}><Link className="reader-return" href={`/book/${book.id}`} aria-label={`返回书籍详情：${title}`}><ChevronLeft size={20}/><span>{title}</span></Link></header>
      <button className="reader-menu-access" onClick={onTools} aria-expanded={props.toolsVisible}>阅读菜单</button>
      <div ref={windowRef} className="reader-page-window" tabIndex={0} aria-label={scrolling?'正文，可上下滚动，点击中央打开菜单':`${turnMode==='vertical'?'上下':'左右'}翻页，点击中央打开菜单`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelGesture} onLostPointerCapture={event=>{if(event.target===event.currentTarget)cancelGesture();}} onClick={click} onTouchStart={touchStart} onTouchEnd={touchEnd} onTouchCancel={()=>{touchEdge.current=null;}} onWheel={wheel}>
        <div ref={surface} className="reader-page-surface">
        <div ref={textWindow} className="reader-text-window" onScroll={onScroll}>
        <div ref={columns} className="reader-columns" style={{fontFamily,fontSize:`${fontSize}px`,lineHeight,transform:scrolling?'none':`translateX(${-page*(layout.width+40)}px)`}}>
          <h1>{title}</h1>
          {paragraphs.map(paragraph=><p key={paragraph.key} className="reader-paragraph" data-paragraph-key={paragraph.key} data-marked={marks.includes(paragraph.key)} data-selected={menu?.paragraph.key===paragraph.key} tabIndex={0}
            onContextMenu={event=>{event.preventDefault();if(!controlsBlocked)openMenu(paragraph,event.clientX,event.clientY);}}
            onKeyDown={event=>{if(event.key==='Enter' || (event.shiftKey && event.key==='F10')){event.preventDefault();const rect=event.currentTarget.getClientRects()[0];openMenu(paragraph,rect.x+80,rect.y+40);}}}>
            <span className="reader-paragraph-text">{paragraph.text}</span>
            {!!counts[paragraph.key] && <button className="paragraph-bubble" data-hot={counts[paragraph.key]>10} aria-label={`${counts[paragraph.key]}条段落评论`} onClick={event=>{event.stopPropagation();setDiscussion(paragraph);}}>{counts[paragraph.key]}</button>}
          </p>)}
        </div>
        </div>
        <footer className="reader-status-bottom"><div className="reader-progress" aria-label="阅读进度"><span data-reader-page>{page+1}/{layout.total}</span><span>{progress}</span></div></footer>
        </div>
        <div ref={preview} className="reader-page-preview" aria-hidden="true" inert hidden/>
      </div>
      <div ref={measureHost} className="reader-measure-host" aria-hidden="true" inert/>
      {props.navigating && <div className="reader-notice" role="status">正在加载章节…</div>}
      {(notice || countError) && <div className="reader-notice" role="status">{notice || '段评暂不可用，正文可继续阅读'}</div>}
    </section>
    {menu && <div className="paragraph-menu-backdrop" onClick={()=>{if(Date.now()>=suppressClickUntil.current)setMenu(null);}}><div ref={menuRef} role="menu" aria-label="段落操作" className="paragraph-menu" style={{left:menu.x,top:menu.y}} onClick={event=>event.stopPropagation()}><button role="menuitem" onClick={()=>{setDiscussion(menu.paragraph);setMenu(null);}}><MessageCircle size={16}/>评论</button><button role="menuitem" onClick={toggleMark}><Highlighter size={16}/>{marks.includes(menu.paragraph.key)?'取消标记':'标记'}</button></div></div>}
    {discussion && <ParagraphComments key={discussion.key} chapterId={chapter.id} paragraph={discussion} onClose={closeDiscussion} onCount={countChanged}/>}
  </div>;
}
