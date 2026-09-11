'use client';

import {memo,useCallback,useEffect,useEffectEvent,useLayoutEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {Highlighter,MessageCircle} from 'lucide-react';
import ReaderReturnLink from './ReaderReturnLink';
import ParagraphComments from './ParagraphComments';
import type {ReaderPageProps} from './ReaderPages';
import type {Chapter} from '@/lib/api';
import {readerParagraphs} from '../../shared/reader-paragraphs.mjs';
import {readerChapterTitle} from '@/lib/reader-layout';
import {cachedReaderCounts,loadReaderChapter,loadReaderCounts,rememberReaderCounts} from '@/lib/reader-chapters';
import {useStoredState} from '@/lib/useStoredState';
import {useAuth} from '@/contexts/AuthContext';
import {READER_TURN_DURATION_MS} from './useReaderPageTurn';
import './reader-pages.css';

type Paragraph={key:string;text:string};
type Selection={chapter:Chapter;paragraph:Paragraph;x:number;y:number};
type Progress={id:string;fraction:number;page:number;total:number};
const validMarks=(value:unknown)=>Array.isArray(value)&&value.length<=10000&&value.every(key=>typeof key==='string'&&/^[a-f0-9]{16}-\d+$/.test(key));
const markKey=(user:string,id:string)=>`reader-paragraph-marks:${user}:${id}`;
function saveProgress(progress:Progress){
  try{localStorage.setItem(`reader-page:${progress.id}`,JSON.stringify({fraction:progress.fraction}));}catch{ /* Reading works without storage. */ }
}

const ScrollChapter=memo(function ScrollChapter({chapter,user,selected,updates,onDiscussion}:{chapter:Chapter;user:string;selected?:string;updates?:Record<string,number>;onDiscussion:(chapter:Chapter,paragraph:Paragraph)=>void}){
  const paragraphs=useMemo(()=>readerParagraphs(chapter.content,chapter.title,chapter.chapter_number),[chapter]);
  const [marks]=useStoredState<string[]>(markKey(user,chapter.id),[],validMarks);
  const [counts,setCounts]=useState(()=>cachedReaderCounts(chapter.id) || {});
  useEffect(()=>{
    let active=true;
    const refresh=()=>{void loadReaderCounts(chapter.id).then(value=>{if(active)setCounts(value);}).catch(()=>{});};
    refresh();window.addEventListener('focus',refresh);
    return()=>{active=false;window.removeEventListener('focus',refresh);};
  },[chapter.id]);
  const visibleCounts={...counts,...updates};
  return <article className="reader-scroll-chapter reader-columns" data-scroll-chapter={chapter.id} aria-label={readerChapterTitle(chapter)}>
    <h1>{readerChapterTitle(chapter)}</h1>
    {paragraphs.map(paragraph=><p key={paragraph.key} className="reader-paragraph" data-paragraph-key={paragraph.key} data-marked={marks.includes(paragraph.key)} data-selected={selected===paragraph.key} tabIndex={0}>
      <span className="reader-paragraph-text">{paragraph.text}</span>
      {!!visibleCounts[paragraph.key] && <button className="paragraph-bubble" data-hot={visibleCounts[paragraph.key]>10} aria-label={`${visibleCounts[paragraph.key]}条段落评论`} onClick={event=>{event.stopPropagation();onDiscussion(chapter,paragraph);}}>{visibleCounts[paragraph.key]}</button>}
    </p>)}
  </article>;
});

export default function ReaderScroll(props:ReaderPageProps){
  const {onChapter,onNearEnd,navigating,chapter:activeChapter}=props;
  const {user}=useAuth(),userId=user?.id || 'guest';
  const viewport=useRef<HTMLDivElement>(null);
  const continuation=useRef<HTMLDivElement>(null);
  const [continuationError,setContinuationError]=useState('');
  const [continuationRetry,setContinuationRetry]=useState(0);
  const [chapters,setChapters]=useState<Chapter[]>([props.chapter]);
  const [progress,setProgress]=useState<Progress>({id:props.chapter.id,fraction:0,page:0,total:1});
  const position=useRef(progress);
  const [ready,setReady]=useState(false);
  const restored=useRef(false),routeChapter=useRef(props.chapter.id),scrollNavigation=useRef<string|null>(null);
  const anchor=useRef<{id:string;top:number}|null>(null);
  const layoutScrollTop=useRef<number|null>(null);
  const [menu,setMenu]=useState<Selection|null>(null),[discussion,setDiscussion]=useState<Selection|null>(null);
  const [countUpdates,setCountUpdates]=useState<Record<string,Record<string,number>>>({});
  const [marks,setMarks]=useStoredState<string[]>(markKey(userId,menu?.chapter.id || props.chapter.id),[],validMarks);
  const menuRef=useRef<HTMLDivElement>(null),suppressClickUntil=useRef(0),touching=useRef(false);
  const heldMenu=useRef(false);
  const gesture=useRef<{x:number;y:number;long:boolean;selection:Selection|null;timer?:ReturnType<typeof setTimeout>}|null>(null);
  const frame=useRef(0),idle=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const idleWork=useRef(()=>{});
  const blocked=props.blocked || !!menu || !!discussion;
  const nodes=useCallback(()=>Array.from(viewport.current?.querySelectorAll<HTMLElement>('[data-scroll-chapter]') || []),[]);
  const nodeFor=useCallback((id:string)=>nodes().find(node=>node.dataset.scrollChapter===id),[nodes]);
  const topOf=useCallback((node:HTMLElement)=>{
    const view=viewport.current!;
    return node.getBoundingClientRect().top-view.getBoundingClientRect().top+view.scrollTop;
  },[]);
  const setScrollPosition=useCallback((top:number)=>{
    const view=viewport.current;if(!view || Math.abs(view.scrollTop-top)<.5)return;
    view.scrollTop=top;layoutScrollTop.current=view.scrollTop;
  },[]);
  const captureAnchor=useCallback(()=>{
    const node=nodeFor(position.current.id);
    if(node)anchor.current={id:position.current.id,top:node.getBoundingClientRect().top};
  },[nodeFor]);

  const measure=useCallback((navigate=false)=>{
    const view=viewport.current,list=nodes();if(!view || !list.length)return;
    const top=view.scrollTop;
    let active=list[0];
    for(const node of list){if(topOf(node)<=top+1)active=node;else break;}
    const height=active.getBoundingClientRect().height,start=topOf(active);
    const total=Math.max(1,Math.ceil(height/view.clientHeight));
    const offset=Math.max(0,top-start);
    const page=top+view.clientHeight>=start+height-1?total-1:Math.min(total-1,Math.floor(offset/view.clientHeight));
    const next={id:active.dataset.scrollChapter!,fraction:Math.min(.999,offset/height),page,total};
    const previous=position.current;
    if(previous.id!==next.id)saveProgress(previous);
    position.current=next;
    setProgress(old=>old.id===next.id && old.page===next.page && old.total===next.total?old:next);
    if(navigate && !blocked && !navigating && next.id!==activeChapter.id && scrollNavigation.current!==next.id){
      saveProgress(next);scrollNavigation.current=next.id;onChapter(next.id);
    }
    if(start+height-top<view.clientHeight*3)onNearEnd();
  },[nodes,topOf,blocked,navigating,activeChapter.id,onChapter,onNearEnd]);

  const resize=useEffectEvent(()=>{
    const saved=position.current,node=nodeFor(saved.id),view=viewport.current;
    if(node && view)setScrollPosition(topOf(node)+saved.fraction*node.getBoundingClientRect().height);
    measure();
  });
  useLayoutEffect(()=>{resize();},[props.fontFamily,props.fontSize,props.lineHeight,props.paragraphGap,props.pageWidth]);

  // Append/prepend keyed chapters without replacing the native scroll container.
  // Only changes above the viewport need an offset correction before paint.
  useLayoutEffect(()=>{
    if(anchor.current){
      const node=nodeFor(anchor.current.id),view=viewport.current;
      if(node && view)setScrollPosition(view.scrollTop+node.getBoundingClientRect().top-anchor.current.top);
      anchor.current=null;
    }
    const navigated=routeChapter.current!==props.chapter.id;
    const fromScroll=navigated && scrollNavigation.current===props.chapter.id;
    const existing=chapters.some(chapter=>chapter.id===props.chapter.id);
    let next=existing?chapters:[props.chapter];
    const previous=props.previousChapter,following=props.nextChapter;
    if(previous?.id===props.previousId && next[0].id===props.chapter.id && !next.some(chapter=>chapter.id===previous.id))next=[previous,...next];
    if(following?.id===props.nextId && next.at(-1)?.id===props.chapter.id && !next.some(chapter=>chapter.id===following.id))next=[...next,following];
    if(next!==chapters){
      captureAnchor();
      // Changing the chapter window must restore its measured anchor before paint.
      setChapters(next);return;
    }
    if(!restored.current || (navigated && !fromScroll)){
      const node=nodeFor(props.chapter.id),view=viewport.current;
      if(node && view){
        let fraction=0;
        try{
          const entry=sessionStorage.getItem(`reader-entry:${props.chapter.id}`);
          const saved=JSON.parse(localStorage.getItem(`reader-page:${props.chapter.id}`)||'null');
          fraction=entry?entry==='end'?Math.max(0,1-view.clientHeight/node.getBoundingClientRect().height):0:Number.isFinite(saved?.fraction)?Math.max(0,Math.min(.999,saved.fraction)):0;
          sessionStorage.removeItem(`reader-entry:${props.chapter.id}`);
        }catch{ /* Default to the chapter start. */ }
        setScrollPosition(topOf(node)+fraction*node.getBoundingClientRect().height);
        restored.current=true;setReady(true);
      }
    }
    routeChapter.current=props.chapter.id;
    if(fromScroll)scrollNavigation.current=null;
    measure();
  },[props.chapter,props.previousChapter,props.nextChapter,props.previousId,props.nextId,chapters,measure,nodeFor,topOf,captureAnchor,setScrollPosition]);

  useLayoutEffect(()=>{
    const view=viewport.current;if(!view)return;
    // Keep this observer attached across chapter changes so it cannot interrupt momentum.
    const observer=new ResizeObserver(()=>resize());observer.observe(view);
    return()=>observer.disconnect();
  },[]);
  useLayoutEffect(()=>()=>saveProgress(position.current),[]);
  useEffect(()=>{
    const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    const save=()=>saveProgress(position.current);window.addEventListener('pagehide',save);
    return()=>{document.body.style.overflow=previous;save();window.removeEventListener('pagehide',save);cancelAnimationFrame(frame.current);clearTimeout(idle.current);clearTimeout(gesture.current?.timer);};
  },[]);

  function settle(){
    saveProgress(position.current);
    if(touching.current || blocked)return;
    const index=chapters.findIndex(chapter=>chapter.id===position.current.id);
    if(chapters.length>5 && index>=0){
      captureAnchor();setChapters(chapters.slice(Math.max(0,index-2),index+3));
    }
  }
  useLayoutEffect(()=>{idleWork.current=settle;});
  useEffect(()=>{
    clearTimeout(idle.current);idle.current=setTimeout(()=>idleWork.current(),200);
    return()=>clearTimeout(idle.current);
  },[chapters]);
  function onScroll(){
    const layoutTop=layoutScrollTop.current;layoutScrollTop.current=null;
    if(layoutTop!==null && Math.abs((viewport.current?.scrollTop || 0)-layoutTop)<1){measure();return;}
    cancelGesture();
    // This runs only for a native scroll event, never during rendering.
    // eslint-disable-next-line react-hooks/purity
    suppressClickUntil.current=Date.now()+READER_TURN_DURATION_MS;
    cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>measure(true));
    clearTimeout(idle.current);idle.current=setTimeout(()=>idleWork.current(),200);
    if(props.toolsVisible && !blocked)props.onHideTools();
  }
  function jump(direction:number){
    if(blocked || props.navigating)return;
    const id=direction<0?props.previousId:props.nextId;
    if(id){saveProgress(position.current);try{sessionStorage.setItem(`reader-entry:${id}`,'start');}catch{}props.onChapter(id);}
  }
  useEffect(()=>{
    const handle=(event:KeyboardEvent)=>{
      if(blocked || (event.target as HTMLElement).closest('input,textarea,[contenteditable=true],[role=dialog],[role=menu]'))return;
      if(event.key==='Escape'){props.onHideTools();return;}
      if(event.key.toLowerCase()==='m'){event.preventDefault();props.onTools();return;}
      if(event.ctrlKey && ['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();jump(event.key==='ArrowLeft'?-1:1);return;}
      if(['PageDown','PageUp','ArrowRight','ArrowLeft','ArrowDown','ArrowUp',' '].includes(event.key)){
        event.preventDefault();props.onHideTools();
        const direction=['PageUp','ArrowLeft','ArrowUp'].includes(event.key) || (event.key===' ' && event.shiftKey)?-1:1;
        viewport.current?.scrollBy({top:direction*viewport.current.clientHeight*.9,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
      }
    };
    window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);
  });

  function selectionAt(target:EventTarget|null,x:number,y:number):Selection|null{
    const paragraph=(target as HTMLElement)?.closest<HTMLElement>('[data-paragraph-key]');
    const id=paragraph?.closest<HTMLElement>('[data-scroll-chapter]')?.dataset.scrollChapter;
    const chapter=chapters.find(chapter=>chapter.id===id);
    return chapter && paragraph?{chapter,paragraph:{key:paragraph.dataset.paragraphKey!,text:paragraph.querySelector('.reader-paragraph-text')?.textContent || ''},x,y}:null;
  }
  function openMenu(selection:Selection,held=false){
    heldMenu.current=held;
    props.onHideTools();suppressClickUntil.current=Date.now()+READER_TURN_DURATION_MS;
    window.getSelection()?.removeAllRanges();setMenu({...selection,x:Math.max(12,Math.min(selection.x-90,innerWidth-216)),y:Math.max(12,Math.min(selection.y-62,innerHeight-70))});
  }
  function cancelGesture(){clearTimeout(gesture.current?.timer);gesture.current=null;}
  const openDiscussion=useCallback((chapter:Chapter,paragraph:Paragraph)=>{setDiscussion({chapter,paragraph,x:0,y:0});},[]);
  const closeDiscussion=useCallback(()=>setDiscussion(null),[]);
  useEffect(()=>{
    if(!menu)return;
    menuRef.current?.querySelector('button')?.focus({preventScroll:true});
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setMenu(null);event.preventDefault();}
      if(event.key==='Tab'){event.preventDefault();const buttons=menuRef.current?.querySelectorAll('button');if(buttons?.length)buttons[document.activeElement===buttons[0]?1:0]?.focus();}
    };
    document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
  },[menu]);
  const title=readerChapterTitle(chapters.find(chapter=>chapter.id===progress.id) || props.chapter);
  const percent=props.chapterTotal && props.chapterIndex>=0?Math.min(100,(props.chapterIndex+(progress.page+1)/progress.total)/props.chapterTotal*100).toFixed(1)+'%':'—';
  const style={'--reader-paper':props.theme.bg,'--reader-ink':props.theme.text,'--reader-panel':props.theme.panel,'--reader-width':`${props.pageWidth}px`,'--reader-paragraph-gap':props.paragraphGap} as CSSProperties;
  const last=chapters.at(-1)!;
  const followingId=last.nextId || (last.id===props.chapter.id?props.nextId:null);
  useEffect(()=>{
    const view=viewport.current,end=continuation.current;
    // The visible text approaching the buffer end demands up to two following
    // chapters, including with data saving enabled, without changing scrollTop.
    if(!view || !end || !followingId || blocked || chapters.length-chapters.findIndex(item=>item.id===progress.id)>2)return;
    let active=true,requested=false;
    const observer=new IntersectionObserver(entries=>{
      if(requested || !entries.some(entry=>entry.isIntersecting))return;
      requested=true;
      void loadReaderChapter(props.book.id,followingId).then(next=>{
        if(!active)return;
        setContinuationError('');
        setChapters(previous=>previous.some(item=>item.id===next.id)?previous:[...previous,next]);
      }).catch(error=>{if(active)setContinuationError(error instanceof Error?error.message:'章节暂不可用，请重试');});
    },{root:view,rootMargin:`0px 0px ${view.clientHeight}px 0px`});
    observer.observe(end);
    return()=>{active=false;observer.disconnect();};
  },[followingId,props.book.id,chapters,progress.id,blocked,continuationRetry]);

  return <div className="reader-pages-root" data-dark={props.dark} data-mode="scroll" data-reader-ready={ready} data-reader-chapter={props.chapter.id} data-reader-previous={props.previousChapter?.id || ''} data-reader-next={props.nextChapter?.id || ''} style={style}>
    <section className="reader-frame" data-paper={props.paper && !props.dark} aria-label="章节阅读">
      <header className="reader-status-top" data-open={props.toolsVisible} inert={!props.toolsVisible} aria-hidden={!props.toolsVisible}><ReaderReturnLink bookId={props.book.id} title={title}/></header>
      <button className="reader-menu-access" onClick={props.onTools} aria-expanded={props.toolsVisible}>阅读菜单</button>
      <div className="reader-page-window" tabIndex={0} aria-label="正文，可连续上下滚动，点击中央打开菜单"
        onPointerDown={event=>{
          if(blocked || !event.isPrimary || event.button!==0 || (event.target as HTMLElement).closest('button,a'))return;
          cancelGesture();const selection=selectionAt(event.target,event.clientX,event.clientY);
          const state={x:event.clientX,y:event.clientY,long:false,selection,timer:undefined as ReturnType<typeof setTimeout>|undefined};
          if(selection)state.timer=setTimeout(()=>{state.long=true;openMenu(selection,true);},450);gesture.current=state;
        }}
        onPointerMove={event=>{const state=gesture.current;if(state && Math.hypot(event.clientX-state.x,event.clientY-state.y)>8){cancelGesture();suppressClickUntil.current=Date.now()+READER_TURN_DURATION_MS;}}}
        onPointerUp={()=>{if(gesture.current?.long)suppressClickUntil.current=Date.now()+READER_TURN_DURATION_MS;cancelGesture();}} onPointerCancel={cancelGesture}
        onTouchStart={()=>{touching.current=true;}} onTouchEnd={()=>{touching.current=false;clearTimeout(idle.current);idle.current=setTimeout(()=>idleWork.current(),200);}} onTouchCancel={()=>{touching.current=false;}}
        onClick={event=>{if(!blocked && Date.now()>=suppressClickUntil.current && !(event.target as HTMLElement).closest('button,a'))props.onTools();}}
        onContextMenu={event=>{event.preventDefault();const selection=selectionAt(event.target,event.clientX,event.clientY);if(selection && !blocked)openMenu(selection,gesture.current?.long || heldMenu.current);}}
        onKeyDown={event=>{if(event.key==='Enter' || (event.shiftKey && event.key==='F10')){const box=(event.target as HTMLElement).getBoundingClientRect(),selection=selectionAt(event.target,box.x+80,box.y+40);if(selection && !blocked){event.preventDefault();openMenu(selection);}}}}>
        <div className="reader-page-surface">
          <div ref={viewport} className="reader-text-window reader-scroll-window" onScroll={onScroll} style={{fontFamily:props.fontFamily,fontSize:`${props.fontSize}px`,lineHeight:props.lineHeight}}>
            {chapters.map(chapter=><ScrollChapter key={chapter.id} chapter={chapter} user={userId} selected={menu?.chapter.id===chapter.id?menu.paragraph.key:undefined} updates={countUpdates[chapter.id]} onDiscussion={openDiscussion}/>)}
            <div ref={continuation} className="reader-scroll-end" aria-hidden="true"/>
          </div>
          <footer className="reader-status-bottom"><div className="reader-progress" aria-label="阅读进度"><span data-reader-page>{progress.page+1}/{progress.total}</span><span>{percent}</span></div></footer>
        </div>
      </div>
    </section>
    {continuationError && <div role="alert" className="reader-navigation-error">{continuationError}<button onClick={()=>{setContinuationError('');setContinuationRetry(value=>value+1);}}>重试</button><button onClick={()=>setContinuationError('')}>关闭</button></div>}
    {menu && <div className="paragraph-menu-backdrop" onPointerDown={()=>{heldMenu.current=false;}} onClickCapture={event=>{if(heldMenu.current){event.preventDefault();event.stopPropagation();}}} onClick={()=>{if(Date.now()>=suppressClickUntil.current)setMenu(null);}}><div ref={menuRef} role="menu" aria-label="段落操作" className="paragraph-menu" style={{left:menu.x,top:menu.y}} onClick={event=>event.stopPropagation()}><button role="menuitem" onClick={()=>{setDiscussion(menu);setMenu(null);}}><MessageCircle size={16}/>评论</button><button role="menuitem" onClick={()=>{const key=menu.paragraph.key;setMarks(previous=>previous.includes(key)?previous.filter(item=>item!==key):[...previous,key]);setMenu(null);}}><Highlighter size={16}/>{marks.includes(menu.paragraph.key)?'取消标记':'标记'}</button></div></div>}
    {discussion && <ParagraphComments key={`${discussion.chapter.id}:${discussion.paragraph.key}`} chapterId={discussion.chapter.id} paragraph={discussion.paragraph} onClose={closeDiscussion} onCount={(key,count)=>{const id=discussion.chapter.id;rememberReaderCounts(id,{...cachedReaderCounts(id),[key]:count});setCountUpdates(previous=>({...previous,[id]:{...previous[id],[key]:count}}));}}/>}
  </div>;
}
