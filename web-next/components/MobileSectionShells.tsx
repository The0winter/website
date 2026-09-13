'use client';

import {useCallback, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {BookOpen} from 'lucide-react';
import {registerMobileSectionShells} from '@/lib/mobile-section-snapshot';
import LibraryToolbar from './LibraryToolbar';
import ForumTabs from './ForumTabs';
import {MobileHomeSection, MobileHomeShortcuts} from './MobileHomeFrame';
import './mobile-home.css';
import '../app/library/library.css';
import '../app/forum/forum.css';

// Prepare the frames with the shared layout, before destination route requests.
// A hidden shadow root keeps these inert controls out of page selectors and IDs.
export default function MobileSectionShells() {
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  const mounted = useRef<{host: HTMLDivElement; root: ShadowRoot} | null>(null);
  const mount = useCallback((host: HTMLDivElement | null) => {
    if (!host) return;
    const root = mounted.current?.host === host ? mounted.current.root : host.attachShadow({mode: 'closed'});
    mounted.current = {host, root};
    setShadow(root);
    return registerMobileSectionShells(root);
  }, []);
  return <><div hidden inert ref={mount}/>{shadow && createPortal(<>
    <div data-mobile-section-shell="/library" className="library-page">
      <div className="library-inner"><div data-section-shell-header/>
        <section className="shelf-panel"><LibraryToolbar/>
          <div className="shelf-empty"><BookOpen size={32}/><p>正在整理你的书架…</p></div>
        </section>
      </div>
    </div>
    <div data-mobile-section-shell="/forum" className="forum-page min-h-screen font-sans">
      <div className="forum-masthead"><div data-section-shell-header/></div>
      <ForumTabs/>
      <div className="border-y border-[var(--home-border)] bg-[var(--home-surface)] min-h-[50vh]">
        <div className="p-10 text-center text-sm text-[var(--home-muted)]">加载中...</div>
      </div>
    </div>
    <div data-mobile-section-shell="/" className="mobile-home">
      <div data-section-shell-header/>
      <div className="mh-banner"><div><span className="mh-kicker">九天精选 · 好书推荐</span><div className="section-loading-line section-loading-title"/><div className="section-loading-line"/></div><div className="mh-cover"/></div>
      <MobileHomeShortcuts/>
      {['热门精选', '精选推荐', '新书上架'].map(title => <MobileHomeSection key={title} title={title}>
        <div className="mh-rows">{[0, 1, 2].map(row => <div key={row} className="mh-book"><div className="mh-cover"/><div className="mh-book-info"><div className="section-loading-line section-loading-title"/><div className="section-loading-line"/><div className="section-loading-line"/></div></div>)}</div>
      </MobileHomeSection>)}
    </div>
  </>, shadow)}</>;
}
