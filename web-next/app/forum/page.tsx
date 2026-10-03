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
import {getForumSnapshot, serverForumSnapshot, subscribeForum, loadForum, loadMoreForum, getForumPosition, rememberForumPosition, reloadForumFollowing} from '@/lib/forum-cache';
import {useForumPagination} from '@/lib/useForumPagination';
import HomeSearchHeader from '@/components/HomeSearchHeader';
import {interruptMobileSectionTransition, navigateMobileSection, startMobileSectionDrag, type MobileSectionDrag} from '@/lib/mobile-section-navigation';
import {sectionSwipeThreshold} from '@/lib/section-swipe';
import './forum.css';

import ForumPostList from '@/components/ForumPostList';
import ForumLink from '@/components/ForumLink';
import {forumEntryHref, plainForumText} from '@/lib/forum-presentation';
import ForumTabs, {FORUM_TABS as TABS, type FeedTab} from '@/components/ForumTabs';
import ForumFeedbackSheet from '@/components/ForumFeedbackSheet';
import {feedbackReasons, isForumRecommended, useForumFeedback, type FeedbackReason} from '@/lib/forum-feedback';
import type {ForumPost} from '@/lib/api';
import {useForumImpressions} from '@/lib/forum-activity';

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
  const selectedTab=useRef<FeedTab|null>(null);
  const selectTab=(tab:FeedTab)=>{selectedTab.current=tab;setActiveTab(tab);};
  
  const {user, loading: authLoading} = useAuth();
  const feedback = useForumFeedback(user?.id || 'guest',!authLoading);
  const [feedbackPost, setFeedbackPost] = useState<ForumPost|null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<{id:string; text:string}|null>(null);
  useEffect(() => {
    if (!feedbackNotice) return;
    const timer = setTimeout(() => setFeedbackNotice(null),8000);
    return () => clearTimeout(timer);
  }, [feedbackNotice]);
  useEffect(() => {setFeedbackPost(null); setFeedbackNotice(null);},[user?.id]);
  const submitFeedback = async (post:ForumPost, reason:FeedbackReason) => {
    try {
      const row = await feedback.add(post,reason);
      const text = reason.startsWith('follow')?'已关注，可在“关注”查看':reason === 'author' ? `不再推荐${row.authorName}的内容` : reason === 'similar' ? '已隐藏这个问题及重复内容' : reason === 'dislike' ? '已隐藏该内容' : `已保存：${feedbackReasons[reason]}`;
      setFeedbackNotice({id:row.id,text});
      if(reason.startsWith('follow'))reloadForumFollowing();
    } catch {setFeedbackNotice({id:'',text:'偏好未能保存，请稍后重试'});}
  };
  const removeFeedback=async(id:string)=>{try{await feedback.remove(id);reloadForumFollowing();setFeedbackNotice(null);}catch{setFeedbackNotice({id:'',text:'偏好未能更新，请稍后重试'});}};
  const {posts: postsCache, loading: loadingState, errors, loadingMore, moreErrors, cursors} = useSyncExternalStore(subscribeForum, getForumSnapshot, serverForumSnapshot);
  const savedPosition = useRef<{tab:FeedTab; search:string; y:number}|null>(null);
  const restoredPosition = useRef(false);
  useEffect(() => {
    if (authLoading) return;
    savedPosition.current = {...getForumPosition()}; restoredPosition.current = false;
    if(selectedTab.current)savedPosition.current={...savedPosition.current,tab:selectedTab.current,y:0};
    setActiveTab(savedPosition.current.tab); setSearchQuery(savedPosition.current.search);
  }, [authLoading, user?.id]);
  useEffect(() => {
    const saved = savedPosition.current;
    if (restoredPosition.current || !saved || activeTab !== saved.tab || searchQuery !== saved.search || !postsCache[activeTab] || !feedback.ready) return;
    const frame = requestAnimationFrame(() => {
      window.scrollTo({top:saved.y, behavior:'instant'}); restoredPosition.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, searchQuery, postsCache, feedback.ready]);
  useEffect(() => {
    const save = () => {if (restoredPosition.current && location.pathname === '/forum') rememberForumPosition({tab:activeTab, search:searchQuery, y:scrollY});};
    window.addEventListener('scroll', save, {passive:true});
    document.addEventListener('pointerdown', save, true);
    return () => {window.removeEventListener('scroll', save); document.removeEventListener('pointerdown', save, true);};
  }, [activeTab, searchQuery]);
  const sentinel = useForumPagination({identity:`${user?.id || 'guest'}:${activeTab}`, enabled:!authLoading && !!postsCache[activeTab],
    loading:!!loadingState[activeTab] || !!loadingMore[activeTab], hasMore:!!cursors[activeTab], error:errors[activeTab] || moreErrors[activeTab],
    loadMore:() => void loadMoreForum(activeTab)});
  const matchesSearch = (post: import('@/lib/api').ForumPost) => !searchQuery.trim() || [post.title, post.excerpt, post.topReply?.title, post.topReply?.content, post.topReply?.author.name].some(value => value?.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase()));
  const topics = [...new Map((postsCache[activeTab] || []).filter(post => post.type === 'question').map(post => [post.id, post])).values()].slice(0,5);

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
  useForumImpressions(feed,postsCache.hot||[],activeTab==='hot'&&!searchQuery.trim()&&!authLoading);
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
    if (e.touches.length !== 1 || (e.target as Element).closest('button, input, select, textarea, [contenteditable], .mh-bottom, .mh-topbar, .forum-publish, dialog, [role=dialog], .qa-dialog-backdrop')) return;
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
      selectTab(TABS[current.index - 1].id);
    } else if (distance < -threshold && current.index < TABS.length - 1) {
      selectTab(TABS[current.index + 1].id);
    }
  };

// ====== 提取热榜页内容渲染器（纯文字版） ======
  const renderHotList = (tabId: FeedTab) => {
    const tabPosts = (postsCache[tabId] || []).filter(post=>isForumRecommended(post,feedback.rows));
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
          const answerLink = forumEntryHref(post);
          
          // 推荐接口提供按真实近期互动衰减后的热度。
          const heat = post.recommendation?.heat ?? topReply?.votes ?? post.votes ?? 0;
          const excerpt = topReply?.excerpt || plainForumText(topReply?.content || '') || post.excerpt || '这个问题还没有回答，点击查看并参与讨论。';
          
          // 前三名使用主题强调色和柔和暖色。
          const rank = index + 1;
          const rankColor = 
            rank === 1 ? 'text-[var(--home-accent)]' :
            rank === 2 ? 'text-[#b38358]' :
            rank === 3 ? 'text-[#ae946f]' :
            currentTheme.textSub;

          return (
            <article
              key={post.entryId || topReply?.id || realId}
              data-entry-id={post.entryId || topReply?.id || realId}
              className={`flex gap-3 md:gap-4 px-4 md:px-6 py-4 md:py-5 ${index < tabPosts.length - 1 ? `border-b ${currentTheme.border}` : ''} hover:bg-black/[0.02] transition-colors`}
            >
              {/* 左侧：排名序号 */}
              <div className={`w-5 md:w-6 flex-shrink-0 text-center text-lg md:text-xl font-bold mt-0.5 ${rankColor}`}>
                {rank}
              </div>

              {/* 右侧：纯文本内容区域（占满剩余宽度） */}
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <ForumLink href={answerLink} className="block">
                  <h2
                    className={`font-bold leading-snug tracking-tight ${currentTheme.textMain} hover:text-[var(--home-accent)] transition-colors line-clamp-2`}
                    style={{ fontSize: `${fontSize + 2}px` }}
                  >
                    {topReply?.title || post.title}
                  </h2>
                </ForumLink>

                <ForumLink href={answerLink} className="block mt-1.5 md:mt-2">
                  <p
                    className={`leading-relaxed line-clamp-1 md:line-clamp-2 ${currentTheme.textSub} hover:text-[var(--home-text)] transition-colors`}
                    style={{ fontSize: `${fontSize - 1}px` }}
                  >
                    {excerpt}
                  </p>
                </ForumLink>

                {/* 底部数据：热度、分享等 */}
                <div className={`mt-2.5 flex items-center gap-4 text-[13px] ${currentTheme.textSub}`}>
                  <span className="inline-flex items-center gap-1 font-medium">
                    {/* 热度火焰小图标 */}
                    <svg className="w-3.5 h-3.5 text-[var(--home-accent)] fill-current" viewBox="0 0 24 24"><path d="M17.5 12.5c0 2.8-2.2 5.5-5.5 5.5s-5.5-2.7-5.5-5.5c0-2.8 5.5-8.5 5.5-8.5s5.5 5.7 5.5 8.5z" /></svg>
                    {heat>0?`${formatCount(heat)} 热度`:'等待更多讨论'}
                  </span>
                  <ForumLink href={post.type === 'question' ? `/forum/question/${realId}` : answerLink} className="hover:text-[var(--home-accent)] transition-colors">{post.type === 'question' ? '查看问题' : '阅读文章'}</ForumLink>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    );
  };

return (
    <div ref={feed} data-forum-theme="white" className={`forum-page min-h-screen ${currentTheme.bg} pb-24 md:pb-12 font-sans transition-colors duration-300`}
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
      <ForumTabs activeTab={activeTab} onSelect={selectTab}/>
      {feedback.error && <p className="forum-list-state" role="status">{feedback.error} <button onClick={()=>void feedback.retry()}>重试</button></p>}

      {/* 移动端内容连续铺满页面；桌面端保留双栏卡片布局。 */}
      <div className="max-w-[1040px] mx-auto px-0 md:px-4 mt-0 md:mt-6 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_300px] gap-5 md:gap-6">
        
        {/* A single feed tree: mobile slides between panels; desktop shows the selected panel. */}
        <div className="forum-mobile-feed w-full relative overflow-hidden" style={{touchAction:'pan-y pinch-zoom'}}>
          <div 
            ref={track} className="forum-feed-track"
            style={{ transform: `translateX(calc(-${activeIndex * 100}% + var(--forum-drag, 0px)))` }}
          >
            {TABS.map(tab => (
              <div key={tab.id} className="forum-feed-panel w-full shrink-0" inert={tab.id!==activeTab} aria-hidden={tab.id!==activeTab}>
                {errors[tab.id] && <div className="forum-feed-error" role="status">{errors[tab.id]}<button onClick={()=>loadForum(tab.id)}>重新加载</button></div>}
                {(tab.id === activeTab || postsCache[tab.id]) && (!errors[tab.id] || postsCache[tab.id]) && (tab.id === 'hot' && !searchQuery.trim() ? renderHotList(tab.id) : <ForumPostList posts={postsCache[tab.id]?.filter(matchesSearch).filter(post => isForumRecommended(post,feedback.rows))} trackImpressions={tab.id===activeTab} loading={!!loadingState[tab.id] || tab.id === 'recommend' && (!feedback.ready || authLoading)} onFeedback={setFeedbackPost} emptyText={searchQuery.trim() ? '已加载的内容中暂无匹配，可继续加载更多。' : tab.id === 'follow' ? '还没有关注内容。在推荐卡片中关注作者或书籍后，这里会显示相关内容。' : '暂时没有新的推荐，稍后再来看看，也可以查看热榜。'}/>)}
                {tab.id === activeTab && <div ref={sentinel} className="forum-feed-more" aria-live="polite">
                  {moreErrors[tab.id] && <p role="alert">{moreErrors[tab.id]}</p>}
                  {cursors[tab.id] && <button type="button" disabled={!!loadingMore[tab.id]} onClick={() => void loadMoreForum(tab.id)}>{loadingMore[tab.id] ? '正在加载更多…' : moreErrors[tab.id] ? '重试' : '加载更多内容'}</button>}
                  {postsCache[tab.id]?.length && !cursors[tab.id] && !loadingState[tab.id] ? <span>暂时没有更多内容，稍后再来看看</span> : null}
                </div>}
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
            <h3 className={`font-bold text-sm mb-4 ${currentTheme.textMain}`}>正在讨论</h3>
            <ul className="flex flex-col gap-3">
              {topics.map((topic, index) => (
                <li key={topic.id} className="flex items-start gap-3 group">
                  <span className={`text-[15px] font-bold w-4 text-center leading-5 ${index < 3 ? 'text-[var(--home-accent)]' : 'text-[var(--home-muted)]'}`}>
                    {index + 1}
                  </span>
                  <ForumLink href={`/forum/question/${topic.id}`} className="text-[14px] text-[var(--home-muted)] leading-snug group-hover:text-[var(--home-accent)] group-hover:underline line-clamp-2">{topic.title}</ForumLink>
                </li>
              ))}
            </ul>
            {!topics.length && <p className="text-sm text-[var(--home-muted)]">从一本书、一个问题开始。</p>}
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
      {feedbackPost && <ForumFeedbackSheet post={feedbackPost} onClose={() => setFeedbackPost(null)} onSelect={reason => void submitFeedback(feedbackPost,reason)}/>}
      {feedbackNotice && <div className="forum-feedback-notice" role="status"><span>{feedbackNotice.text}</span>{feedbackNotice.id && <button onClick={() => void removeFeedback(feedbackNotice.id)}>撤销</button>}</div>}
    </div>
  );
}
