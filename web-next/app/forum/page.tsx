'use client';
import MobileBottomNav from '@/components/MobileBottomNav';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  Feather,
  HelpCircle,
  Plus,
  Scroll,
  Search,
} from 'lucide-react';
import {useAuth} from '@/contexts/AuthContext';
import {getForumSnapshot, serverForumSnapshot, subscribeForum, loadForum} from '@/lib/forum-cache';
import HomeSearchHeader from '@/components/HomeSearchHeader';
import {interruptMobileSectionTransition, navigateMobileSection, startMobileSectionDrag, type MobileSectionDrag} from '@/lib/mobile-section-navigation';
import {sectionSwipeThreshold} from '@/lib/section-swipe';
import './forum.css';

import ForumPostList from '@/components/ForumPostList';
import ForumTabs, {FORUM_TABS as TABS, type FeedTab} from '@/components/ForumTabs';

const HOT_TOPICS = [
  '春招和秋招，哪个窗口更值得冲？',
  'AI 工具是否会重塑内容行业门槛？',
  '应届生第一份工作到底该看重什么？',
  '跨专业转前端，如何准备作品集？',
  '长期写作如何避免表达同质化？'
];

const currentTheme = {
  bg: 'bg-[var(--home-background)]',
  card: 'md:bg-[var(--home-surface)]',
  textMain: 'text-[var(--home-text)]',
  textSub: 'text-[var(--home-muted)]',
  border: 'border-[var(--home-border)]',
  tabActive: 'text-[var(--home-accent)] border-[var(--home-accent)]',
  tabIdle: 'text-[var(--home-muted)] border-transparent hover:text-[var(--home-text)]',
  chipBg: 'bg-[var(--home-soft)]',
  chipHover: 'hover:bg-[var(--home-accent-soft)]',
};
const fontSize = 16;

function formatCount(value: number) {
  if (!value) return '0';
  if (value >= 10000) return `${(value / 10000).toFixed(1)}w`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export default function ForumPage() {
  const [searchQuery, setSearchQuery] = useState(''); // 🔥 新增：搜索框状态
  
  const [activeTab, setActiveTab] = useState<FeedTab>('recommend');
  
  const {user, loading: authLoading} = useAuth();
  const {posts: postsCache, loading: loadingState, errors} = useSyncExternalStore(subscribeForum, getForumSnapshot, serverForumSnapshot);

  // ====== 滑动轮播专属状态 ======
  const activeIndex = TABS.findIndex(t => t.id === activeTab);
  // Gesture decisions must be synchronous: a quick release can arrive before
  // React renders the direction/offset updates from the last touchmove.
  const gesture = useRef<{id: number; x: number; y: number; dx: number; direction: 'h' | 'v' | null; index: number} | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const moveTrack = (offset: number, dragging: boolean) => {
    if (!track.current) return;
    track.current.style.setProperty('--forum-drag', `${offset}px`);
    track.current.toggleAttribute('data-dragging', dragging);
  };
  const suppressSwipeClick = useRef(false);
  const feed = useRef<HTMLDivElement>(null);
  const horizontalSwipe = useRef(false);
  const sectionDrag = useRef<MobileSectionDrag | undefined>(undefined);
  useEffect(() => () => sectionDrag.current?.cancel(), []);
  useEffect(() => {
    const host = feed.current;
    const move = (event: TouchEvent) => {if (horizontalSwipe.current && event.touches.length === 1 && event.cancelable) event.preventDefault();};
    host?.addEventListener('touchmove', move, {passive: false});
    return () => host?.removeEventListener('touchmove', move);
  }, []);

  useEffect(() => {if (!authLoading) loadForum(activeTab);}, [authLoading, user?.id, activeTab]);

  // ====== 移动端滑动事件处理 ======
  const handleTouchStart = (e: React.TouchEvent) => {
    handleTouchCancel();
    suppressSwipeClick.current = false;
    if (e.touches.length !== 1 || (e.target as Element).closest('button, input, select, textarea, [contenteditable], .mh-bottom, .mh-topbar, .forum-publish, dialog')) return;
    const touch = e.touches[0];
    gesture.current = {id: touch.identifier, x: touch.clientX, y: touch.clientY, dx: 0, direction: null, index: activeIndex};
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) {handleTouchCancel(); return;}
    const current = gesture.current;
    if (!current) return;
    const touch = e.touches[0];
    if (touch.identifier !== current.id) {handleTouchCancel(); return;}
    const diffX = touch.clientX - current.x;
    const diffY = touch.clientY - current.y;
    current.dx = diffX;

    // 滑动超过 10px 时锁定防误触方向
    if (!current.direction) {
      if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
        current.direction = Math.abs(diffX) > Math.abs(diffY) ? 'h' : 'v';
      }
    }

    if (current.direction === 'h') {
      if (!horizontalSwipe.current && !interruptMobileSectionTransition()) {handleTouchCancel(); return;}
      horizontalSwipe.current = true;
      suppressSwipeClick.current = true;
      let newOffset = diffX;
      // At the recommendation edge the entire section follows the finger.
      if (current.index === 0 && diffX > 0) {
        sectionDrag.current ??= startMobileSectionDrag(e.currentTarget, 'home');
        sectionDrag.current?.update(diffX);
        newOffset = 0;
      }
      else if (current.index === TABS.length - 1 && diffX < 0) {
        newOffset = diffX * 0.3;
      }
      if (diffX <= 0 && sectionDrag.current) {sectionDrag.current.cancel(); sectionDrag.current = undefined;}
      moveTrack(newOffset, true);
    }
  };

  const handleTouchCancel = () => {
    const drag = sectionDrag.current;
    sectionDrag.current = undefined;
    gesture.current = null;
    horizontalSwipe.current = false;
    moveTrack(0, false);
    drag?.release(false);
  };

  const handleTouchEnd = (event: React.TouchEvent) => {
    const current = gesture.current;
    if (event.touches.length || !current || current.direction !== 'h') {handleTouchCancel(); return;}
    const touch = Array.from(event.changedTouches).find(touch => touch.identifier === current.id);
    const distance = touch ? touch.clientX - current.x : current.dx;
    const drag = sectionDrag.current;
    // Clear ownership before releasing: committing can navigate/unmount this page.
    sectionDrag.current = undefined;
    gesture.current = null;
    horizontalSwipe.current = false;
    moveTrack(0, false);

    const threshold = sectionSwipeThreshold(window.innerWidth);
    if (drag) {
      drag.update(distance);
      drag.release(distance > threshold);
    } else if (distance > threshold && current.index === 0) {
      navigateMobileSection(event.currentTarget, 'home');
    } else if (distance > threshold && current.index > 0) {
      setActiveTab(TABS[current.index - 1].id);
    } else if (distance < -threshold && current.index < TABS.length - 1) {
      setActiveTab(TABS[current.index + 1].id);
    }
  };

// ====== 提取热榜页内容渲染器（纯文字版） ======
  const renderHotList = (tabId: FeedTab) => {
    const tabPosts = postsCache[tabId] || [];
    const isTabLoading = loadingState[tabId];

    return (
      <div className={`overflow-hidden md:rounded-2xl md:border ${currentTheme.border} ${currentTheme.card} w-full min-h-[50vh]`}>
        {isTabLoading && (
          <div className={`p-10 text-center text-sm ${currentTheme.textSub}`}>加载中...</div>
        )}

        {!isTabLoading && tabPosts.length === 0 && (
          <div className={`p-10 text-center text-sm ${currentTheme.textSub}`}>暂无热榜内容</div>
        )}

        {!isTabLoading && tabPosts.map((post, index) => {
          const realId = post.id;
          if (!realId) return null;

          const topReply = post.topReply || null;
          const answerLink = topReply?.id ? `/forum/${topReply.id}?fromQuestion=${realId}` : `/forum/question/${realId}`;
          
          // 热度计算：默认拿投票数作为热度，你之后可以根据后端实际算法替换
          const heat = topReply?.votes ?? post.votes ?? 0;
          const excerpt = topReply?.content || '这个问题还没有回答，点击查看并参与讨论。';
          
          // 前三名使用主题强调色和柔和暖色。
          const rank = index + 1;
          const rankColor = 
            rank === 1 ? 'text-[var(--home-accent)]' :
            rank === 2 ? 'text-[#b38358]' :
            rank === 3 ? 'text-[#ae946f]' :
            currentTheme.textSub;

          return (
            <article
              key={realId}
              className={`flex gap-3 md:gap-4 px-4 md:px-6 py-4 md:py-5 ${index < tabPosts.length - 1 ? `border-b ${currentTheme.border}` : ''} hover:bg-black/[0.02] transition-colors`}
            >
              {/* 左侧：排名序号 */}
              <div className={`w-5 md:w-6 flex-shrink-0 text-center text-lg md:text-xl font-bold mt-0.5 ${rankColor}`}>
                {rank}
              </div>

              {/* 右侧：纯文本内容区域（占满剩余宽度） */}
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <Link href={`/forum/question/${realId}`} className="block">
                  <h2
                    className={`font-bold leading-snug tracking-tight ${currentTheme.textMain} hover:text-[var(--home-accent)] transition-colors line-clamp-2`}
                    style={{ fontSize: `${fontSize + 2}px` }}
                  >
                    {post.title}
                  </h2>
                </Link>

                <Link href={answerLink} className="block mt-1.5 md:mt-2">
                  <p
                    className={`leading-relaxed line-clamp-1 md:line-clamp-2 ${currentTheme.textSub} hover:text-[var(--home-text)] transition-colors`}
                    style={{ fontSize: `${fontSize - 1}px` }}
                  >
                    {excerpt}
                  </p>
                </Link>

                {/* 底部数据：热度、分享等 */}
                <div className={`mt-2.5 flex items-center gap-4 text-[13px] ${currentTheme.textSub}`}>
                  <span className="inline-flex items-center gap-1 font-medium">
                    {/* 热度火焰小图标 */}
                    <svg className="w-3.5 h-3.5 text-[var(--home-accent)] fill-current" viewBox="0 0 24 24"><path d="M17.5 12.5c0 2.8-2.2 5.5-5.5 5.5s-5.5-2.7-5.5-5.5c0-2.8 5.5-8.5 5.5-8.5s5.5 5.7 5.5 8.5z" /></svg>
                    {formatCount(heat)} 热度
                  </span>
                  <button className="hover:text-[var(--home-accent)] transition-colors flex items-center gap-1">
                    分享
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    );
  };

return (
    <div ref={feed} data-forum-theme="home" className={`forum-page min-h-screen ${currentTheme.bg} pb-24 md:pb-12 font-sans transition-colors duration-300`}
      onTouchStart={event => {if (matchMedia('(max-width: 767px)').matches) handleTouchStart(event);}}
      onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchCancel}
      onClickCapture={event => {
        if (suppressSwipeClick.current && event.nativeEvent.isTrusted) {event.preventDefault(); event.stopPropagation(); suppressSwipeClick.current = false;}
      }}>
      <div className="forum-masthead">
        <h1 className="sr-only">书友社区</h1>
        <HomeSearchHeader>
          <form className="forum-search book-search book-search--home" role="search" onSubmit={event => event.preventDefault()}>
            <div className="book-search-field"><Search size={19} aria-hidden="true"/><input type="search" aria-label="搜索你想看的问题或文章" placeholder="搜索问题或文章" value={searchQuery} onChange={event => setSearchQuery(event.target.value)}/></div>
          </form>
        </HomeSearchHeader>
      </div>
      <ForumTabs activeTab={activeTab} onSelect={setActiveTab}/>

      {/* 移动端内容连续铺满页面；桌面端保留双栏卡片布局。 */}
      <div className="max-w-[1040px] mx-auto px-0 md:px-4 mt-0 md:mt-6 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_300px] gap-5 md:gap-6">
        
        {/* A single feed tree: mobile slides between panels; desktop shows the selected panel. */}
        <div className="forum-mobile-feed w-full relative overflow-hidden" style={{ touchAction: 'pan-y pinch-zoom' }}>
          <div 
            ref={track} className="forum-feed-track"
            style={{ transform: `translateX(calc(-${activeIndex * 100}% + var(--forum-drag, 0px)))` }}
          >
            {TABS.map(tab => (
              <div key={tab.id} className="forum-feed-panel w-full shrink-0" inert={tab.id!==activeTab} aria-hidden={tab.id!==activeTab}>
                {errors[tab.id] && <div className="forum-feed-error" role="status">{errors[tab.id]}<button onClick={()=>loadForum(tab.id)}>重新加载</button></div>}
                {(tab.id === activeTab || postsCache[tab.id]) && (!errors[tab.id] || postsCache[tab.id]) && (tab.id === 'hot' ? renderHotList(tab.id) : <ForumPostList posts={postsCache[tab.id]} loading={loadingState[tab.id]}/>)}
              </div>
            ))}
          </div>
        </div>

        <aside className="hidden md:flex flex-col gap-6">
          <div className={`${currentTheme.card} rounded-2xl border ${currentTheme.border} p-5 shadow-sm`}>
            <div className="flex items-center justify-between mb-5">
              <span className={`text-sm font-bold ${currentTheme.textMain}`}>创作中心</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Link
                href="/forum/create?type=question"
                className={`flex flex-col items-center justify-center gap-2 py-4 rounded-xl transition-colors group cursor-pointer ${currentTheme.chipBg} ${currentTheme.chipHover}`}
              >
                <HelpCircle className="w-5 h-5 text-[var(--home-muted)] group-hover:text-[var(--home-accent)]" />
                <span className="text-xs text-[var(--home-muted)] font-medium">提问</span>
              </Link>

              <Link
                href="/forum/create?type=article"
                className={`flex flex-col items-center justify-center gap-2 py-4 rounded-xl transition-colors group cursor-pointer ${currentTheme.chipBg} ${currentTheme.chipHover}`}
              >
                <Scroll className="w-5 h-5 text-[var(--home-muted)] group-hover:text-[var(--home-accent)]" />
                <span className="text-xs text-[var(--home-muted)] font-medium">文章</span>
              </Link>
            </div>

            <Link
              href="/forum/create?type=article"
              className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 bg-[var(--home-accent)] text-white text-sm rounded-xl hover:brightness-95 transition-all shadow-sm"
            >
              <Feather className="w-3.5 h-3.5" /> 开始创作
            </Link>
          </div>

          <div className={`${currentTheme.card} rounded-2xl border ${currentTheme.border} p-5 shadow-sm`}>
            <h3 className={`font-bold text-sm mb-4 ${currentTheme.textMain}`}>热门话题</h3>
            <ul className="flex flex-col gap-3">
              {HOT_TOPICS.map((topic, index) => (
                <li key={topic} className="flex items-start gap-3 cursor-pointer group">
                  <span className={`text-[15px] font-bold w-4 text-center leading-5 ${index < 3 ? 'text-[var(--home-accent)]' : 'text-[var(--home-muted)]'}`}>
                    {index + 1}
                  </span>
                  <span className="text-[14px] text-[var(--home-muted)] leading-snug group-hover:text-[var(--home-accent)] group-hover:underline line-clamp-2">
                    {topic}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <Link
        href="/forum/create?type=question"
        className="forum-publish md:hidden fixed right-4 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 bg-[var(--home-accent)] text-white shadow-[0_4px_14px_var(--home-accent-soft)]"
      >
        <Plus className="w-5 h-5" />
        <span className="text-sm font-semibold">发布</span>
      </Link>
      <MobileBottomNav/>
    </div>
  );
}
