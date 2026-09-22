'use client';

import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import Link from 'next/link';
import {createPortal} from 'react-dom';
import {BookOpen, ChevronRight, MoreHorizontal} from 'lucide-react';
import {registerMobileSectionShells} from '@/lib/mobile-section-snapshot';
import {invalidateMobileSectionPreview} from '@/lib/mobile-section-navigation';
import {getLibrarySnapshot, serverLibrarySnapshot, subscribeLibrary, type LibrarySort} from '@/lib/library-cache';
import {getForumSnapshot, serverForumSnapshot, subscribeForum} from '@/lib/forum-cache';
import {useAuth} from '@/contexts/AuthContext';
import {useStoredState} from '@/lib/useStoredState';
import ShelfBookContent from './ShelfBookContent';
import LibraryToolbar from './LibraryToolbar';
import ForumTabs from './ForumTabs';
import ForumPostList from './ForumPostList';
import {MobileHomeSection, MobileHomeShortcuts} from './MobileHomeFrame';
import './mobile-home.css';
import '../app/library/library.css';
import '../app/forum/forum.css';

// Prepare the frames with the shared layout, before destination route requests.
// A hidden shadow root keeps these inert controls out of page selectors and IDs.
export default function MobileSectionShells() {
  const {user} = useAuth();
  const [sort] = useStoredState<LibrarySort>('library-sort', 'combined', value => value === 'combined' || value === 'read' || value === 'updated');
  const forum = useSyncExternalStore(subscribeForum, getForumSnapshot, serverForumSnapshot);
  const shelf = useSyncExternalStore(subscribeLibrary, () => getLibrarySnapshot({userId: user?.id || '', tab: 'shelf', sort, page: 1}), serverLibrarySnapshot);
  useEffect(() => subscribeForum(() => invalidateMobileSectionPreview('/forum')), []);
  useEffect(() => {invalidateMobileSectionPreview('/library');}, [shelf]);
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
        <section className="shelf-panel"><LibraryToolbar sort={sort} empty={!shelf.rows?.length}/>
          <div className="shelf-page">
          {shelf.rows === null ? <div className="shelf-empty"><BookOpen size={32}/><p>{shelf.error || '正在整理你的书架…'}</p></div>
            : shelf.rows.length === 0 ? <div className="shelf-empty"><div className="shelf-empty-icon"><BookOpen size={32}/></div><h2>把喜欢的故事，放进书架</h2><p>找到喜欢的书，加入书架就能随时接着读。</p><Link prefetch={false} href="/">去发现好书 <ChevronRight size={15}/></Link></div>
            : <><div className="shelf-rows">{shelf.rows.map(entry => <article className="shelf-row" key={entry.bookId}>
              <a className="shelf-book"><ShelfBookContent entry={entry} tab="shelf"/></a>
              <div className="shelf-more"><button className="shelf-more-button"><MoreHorizontal size={20}/></button></div>
            </article>)}</div>
            {shelf.total <= 2 && <div className="shelf-discover"><span>下一本好书，等你发现</span><Link prefetch={false} href="/">去精选 <ChevronRight size={14}/></Link></div>}
            {shelf.total > 20 && <nav className="shelf-pagination"><button disabled>上一页</button><span>1 / {Math.ceil(shelf.total / 20)}</span><button>下一页</button></nav>}</>}
          </div>
        </section>
      </div>
    </div>
    <div data-mobile-section-shell="/forum" className="forum-page min-h-screen font-sans">
      <div className="forum-masthead"><div data-section-shell-header/></div>
      <ForumTabs/>
      <ForumPostList posts={forum.posts.recommend} loading={forum.loading.recommend}/>
    </div>
    <div data-mobile-section-shell="/" className="mobile-home">
      <div data-section-shell-header/>
      <div className="mh-banner"><div><span className="mh-kicker">九天精选 · 好书推荐</span><div className="section-loading-line section-loading-title"/><div className="section-loading-line"/></div><div className="mh-cover"/></div>
      <MobileHomeShortcuts/>
      {['为你推荐', '值得一读'].map(title => <MobileHomeSection key={title} title={title}>
        <div className="mh-rows">{[0, 1, 2].map(row => <div key={row} className="mh-book"><div className="mh-cover"/><div className="mh-book-info"><div className="section-loading-line section-loading-title"/><div className="section-loading-line"/><div className="section-loading-line"/></div></div>)}</div>
      </MobileHomeSection>)}
    </div>
  </>, shadow)}</>;
}
