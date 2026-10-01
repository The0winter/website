'use client';
import {useLayoutEffect,useRef,type ReactNode} from 'react';
import {animateElement} from '@/lib/browser-animation';
import {SECTION_TURN_DURATION,SECTION_TURN_EASING} from '@/lib/section-swipe';
import './forum-slide.css';

export default function ForumSlide({children,className='',enabled=true,checkpointKey}: {children:ReactNode;className?:string;enabled?:boolean;checkpointKey?:string}) {
  const element = useRef<HTMLDivElement>(null),started = useRef(false);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node || !enabled || started.current) return;
    started.current = true;
    // Preserve restored reading positions. No animation should collapse a long
    // answer underneath an existing scroll checkpoint.
    try {if (checkpointKey && sessionStorage.getItem(checkpointKey)) return;} catch { /* Optional checkpoints. */ }
    if (scrollY > 4 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const height = Math.max(160,innerHeight - node.getBoundingClientRect().top);
    node.style.setProperty('--forum-slide-height',`${height}px`);
    node.dataset.forumEntering = '';
    // Animate one viewport-sized paint surface. Never clone the DOM, animate
    // every answer, or run a per-frame layout/scroll loop over the article.
    const distance = matchMedia('(max-width:767px)').matches ? '100%' : '36px';
    const motion = animateElement(node,[{transform:`translate3d(${distance},0,0)`},{transform:'translate3d(0,0,0)'}],{duration:SECTION_TURN_DURATION,easing:SECTION_TURN_EASING,fill:'both'});
    let released = false;
    const release = () => {
      if (released) return;
      released = true; motion.cancel(); delete node.dataset.forumEntering;
      node.style.removeProperty('--forum-slide-height');
      window.removeEventListener('touchstart',release); window.removeEventListener('wheel',release);
    };
    void motion.finished.then(release);
    window.addEventListener('touchstart',release,{passive:true,once:true});
    window.addEventListener('wheel',release,{passive:true,once:true});
    return release;
  },[enabled,checkpointKey]);
  return <div ref={element} className={className}>{children}</div>;
}
