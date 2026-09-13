'use client';

import type {ReactNode} from 'react';
import {CalendarDays, ChevronRight, LayoutGrid, Trophy} from 'lucide-react';
import Link from './PrefetchLink';

export function MobileHomeShortcuts({onCategory, onNew}: {onCategory?: () => void; onNew?: () => void}) {
  return <nav className="mh-shortcuts" aria-label="找书入口"><button onClick={onCategory}><span className="mh-icon coral"><LayoutGrid/></span>分类</button><button onClick={onNew}><span className="mh-icon rose"><CalendarDays/></span>新书</button><Link href="/ranking"><span className="mh-icon purple"><Trophy/></span>排行</Link></nav>;
}

export function MobileHomeSection({title, onMore, children}: {title: string; onMore?: () => void; children: ReactNode}) {
  return <section className="mh-section"><header><h2>{title}</h2>{title === '新书上架' ? <button onClick={onMore}>更多 <ChevronRight size={14}/></button> : <Link href="/ranking">更多 <ChevronRight size={14}/></Link>}</header>{children}</section>;
}
