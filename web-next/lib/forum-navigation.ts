import {animateElement} from './browser-animation';
import {SECTION_TURN_DURATION,SECTION_TURN_EASING} from './section-swipe';
import {warmForumDestination} from './forum-reading-cache';

type Router={replace:(href:string,options?:{scroll?:boolean})=>void};
let router:Router|undefined;
let active:{cancel:()=>void;finished:Promise<boolean>}|undefined;
const currentHref=()=>location.pathname+location.search;

// Copy only visible feed cards and a few controls. Never copy a long answer,
// the full feed, hidden tabs, or walk computed styles for every descendant.
function captureFeed(source:HTMLElement) {
  const snapshot=source.cloneNode(false) as HTMLElement;
  snapshot.classList.add('forum-navigation-source');snapshot.setAttribute('aria-hidden','true');snapshot.inert=true;
  Object.assign(snapshot.style,{margin:'0',padding:'0',height:'100dvh',minHeight:'0',fontFamily:getComputedStyle(source).fontFamily});
  const rows=source.querySelectorAll<HTMLElement>('.forum-feed-panel[aria-hidden=false] article, .forum-masthead, .forum-feed-toolbar, aside, .forum-publish, .mh-bottom, .fq-topbar, .fq-heading, .fq-tabs, .fq-answer, .fq-actions');
  const visible=[...rows].map(node=>({node,rect:node.getBoundingClientRect()})).filter(({rect})=>rect.width>0&&rect.bottom>0&&rect.top<innerHeight);
  for(const {node,rect} of visible) {
    const copy=node.cloneNode(true) as HTMLElement;
    Object.assign(copy.style,{position:'absolute',top:`${rect.top}px`,left:`${rect.left}px`,width:`${rect.width}px`,height:`${rect.height}px`,margin:'0',bottom:'auto',right:'auto',boxSizing:'border-box'});
    snapshot.append(copy);
  }
  document.body.append(snapshot);
  return snapshot;
}

export function afterForumNavigation() {return active?.finished??Promise.resolve(true);}

export function installForumNavigation(next:Router) {
  router=next;
  const pop=(event:PopStateEvent)=>{
    active?.cancel();
    const visit=event.state?.forumReadingVisit;
    // An interrupted entry still contains the source's temporary Next tree.
    // Forward must request the actual destination rather than show that tree.
    if(visit&&!visit.ready&&(visit.href===currentHref()||visit.sourceHref===currentHref())){event.stopImmediatePropagation();next.replace(visit.href);}
  };
  const leave=()=>active?.cancel();
  window.addEventListener('popstate',pop,true);window.addEventListener('pagehide',leave);
  return()=>{window.removeEventListener('popstate',pop,true);window.removeEventListener('pagehide',leave);leave();router=undefined;};
}

export function navigateForumLink(href:string) {
  warmForumDestination(href);
  const url=new URL(href,location.origin),match=/^\/forum\/(?:question\/)?([^/]+)$/.exec(url.pathname);
  const source=document.querySelector<HTMLElement>('main .forum-page, main .forum-question-page, main .qa-reader');
  if(!router||!source||url.origin!==location.origin||!match||match[1]==='create'||href===currentHref())return false;
  if(active)return true;
  const template=url.pathname.startsWith('/forum/question/')?'#forum-question-loading-template':'#forum-loading-template';
  const shell=document.querySelector<HTMLElement>(template+'>.forum-loading')?.cloneNode(true) as HTMLElement|undefined;
  if(!shell)return false;
  const destination=url.pathname+url.search,sourceHref=currentHref(),next=router;
  const destinationSelector=`main ${url.pathname.startsWith('/forum/question/')?'.forum-question-page':''}[data-forum-document="${CSS.escape(match[1])}"]`;
  // Keep the live reader underneath until the slide finishes, rather than clone long prose.
  const fromReader=source.classList.contains('qa-reader');
  const snapshot=fromReader||matchMedia('(prefers-reduced-motion:reduce)').matches?undefined:captureFeed(source),panel=document.createElement('div');
  panel.className='forum-navigation-panel';panel.tabIndex=-1;panel.setAttribute('aria-label','正在打开论坛正文');panel.setAttribute('aria-busy','true');panel.append(shell);
  document.body.append(panel);panel.focus({preventScroll:true});
  let resolve!:(ready:boolean)=>void,closed=false,ready=false,moving=true;
  let frame=0,settleFrame=0;
  const finished=new Promise<boolean>(done=>{resolve=done;});
  const cleanup=(success:boolean)=>{
    if(closed)return;closed=true;
    observer.disconnect();clearTimeout(timer);cancelAnimationFrame(frame);cancelAnimationFrame(settleFrame);motion?.cancel();
    panel.remove();snapshot?.remove();if(active?.finished===finished)active=undefined;resolve(success);
    if(success&&!document.querySelector('dialog[open]'))document.querySelector<HTMLElement>(destinationSelector)?.focus({preventScroll:true});
  };
  const reveal=()=>{
    if(closed||!ready||moving)return;
    const visit={href:destination,ready:true,sourceHref};
    history.replaceState({...history.state,forumReadingVisit:visit},'',destination);
    // Allow restored reading positions to settle before uncovering the text.
    frame=requestAnimationFrame(()=>{settleFrame=requestAnimationFrame(()=>cleanup(true));});
  };
  const check=()=>{
    if(ready||closed||currentHref()!==destination)return;
    if(document.querySelector(destinationSelector)){ready=true;observer.disconnect();clearTimeout(timer);reveal();}
  };
  const observer=new MutationObserver(check);
  observer.observe(document.querySelector('main')!,{childList:true,subtree:true,attributes:true,attributeFilter:['data-forum-document']});
  active={cancel:()=>cleanup(false),finished};
  const back=()=>{cleanup(false);history.back();};
  shell.querySelector('a')?.addEventListener('click',event=>{event.preventDefault();back();});
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();back();}else if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key)&&event.target===panel)event.preventDefault();});
  panel.addEventListener('wheel',event=>event.preventDefault(),{passive:false});
  const timer=setTimeout(()=>{
    if(closed)return;
    panel.setAttribute('aria-busy','false');shell.setAttribute('aria-busy','false');
    const status=shell.querySelector<HTMLElement>('.forum-loading-status')!;status.setAttribute('role','alert');status.textContent='正文暂时未能加载，请重试';
    const actions=document.createElement('div');actions.className='forum-navigation-retry';
    for(const [label,action] of [['重试',()=>location.replace(destination)],['返回论坛',back]] as const){const button=document.createElement('button');button.textContent=label;button.onclick=action;actions.append(button);}
    status.after(actions);
  },20000);
  const motion=animateElement(panel,[{transform:matchMedia('(max-width:767px)').matches?'translateX(100%)':'translateX(36px)'},{transform:'translateX(0)'}],{duration:SECTION_TURN_DURATION,easing:SECTION_TURN_EASING,fill:'both'});
  void motion.finished.then(()=>{if(closed)return;moving=false;if(fromReader)next.replace(destination);reveal();});
  // Reserve exactly one history slot before the RSC request, matching the
  // book-detail flow. Back can cancel immediately, even on a cold connection.
  const state={...history.state,forumReadingVisit:{href:destination,ready:false,sourceHref}};
  delete state.bookNavigation;
  // The reader consumes search parameters, so defer its URL change until it is covered.
  history.pushState(state,'',fromReader?sourceHref:destination);if(!fromReader)next.replace(destination);check();
  return true;
}
