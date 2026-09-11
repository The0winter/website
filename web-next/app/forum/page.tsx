'use client';
import MobileBottomNav from '@/components/MobileBottomNav';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image'; // 🔥 新增：用于显示网站标志
import {
  Feather,
  HelpCircle,
  MessageCircle,
  Plus,
  Scroll,
  Search,
  ThumbsUp,
} from 'lucide-react';
import { forumApi, ForumPost } from '@/lib/api';
import '@/components/home-search-header.css';
import './forum.css';

type FeedTab = 'recommend' | 'hot' | 'follow';

const TABS: Array<{ id: FeedTab; label: string }> = [
  { id: 'follow', label: '关注' },
  { id: 'recommend', label: '推荐' },
  { id: 'hot', label: '热榜' }
];

const HOT_TOPICS = [
  '春招和秋招，哪个窗口更值得冲？',
  'AI 工具是否会重塑内容行业门槛？',
  '应届生第一份工作到底该看重什么？',
  '跨专业转前端，如何准备作品集？',
  '长期写作如何避免表达同质化？'
];

const currentTheme = {
  bg: 'bg-[var(--home-background)]',
  card: 'bg-[var(--home-surface)]',
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
  
  // ====== 状态升级：缓存多页数据与加载状态 ======
  const [postsCache, setPostsCache] = useState<Record<string, ForumPost[]>>({});
  const [loadingState, setLoadingState] = useState<Record<string, boolean>>({
    follow: true, recommend: true, hot: true
  });
  const initializedRef = useRef(false);

  // ====== 滑动轮播专属状态 ======
  const activeIndex = TABS.findIndex(t => t.id === activeTab);
  const [touchStartPos, setTouchStartPos] = useState<{x: number, y: number} | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [swipeDir, setSwipeDir] = useState<'h' | 'v' | null>(null);

  // 1. 初始化静默预加载所有 Tab 的数据
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    TABS.forEach(tab => {
      forumApi.getPosts(tab.id).then(data => {
        setPostsCache(prev => ({ ...prev, [tab.id]: data || [] }));
        setLoadingState(prev => ({ ...prev, [tab.id]: false }));
      }).catch(error => {
        console.error(`Failed to fetch forum posts for ${tab.id}:`, error);
        setLoadingState(prev => ({ ...prev, [tab.id]: false }));
      });
    });
  }, []);

  // ====== 移动端滑动事件处理 ======
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartPos({ x: e.targetTouches[0].clientX, y: e.targetTouches[0].clientY });
    setIsDragging(true);
    setDragOffset(0);
    setSwipeDir(null);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPos) return;
    const currentX = e.targetTouches[0].clientX;
    const currentY = e.targetTouches[0].clientY;
    const diffX = currentX - touchStartPos.x;
    const diffY = currentY - touchStartPos.y;

    let dir = swipeDir;
    // 滑动超过 10px 时锁定防误触方向
    if (!dir) {
      if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
        dir = Math.abs(diffX) > Math.abs(diffY) ? 'h' : 'v';
        setSwipeDir(dir);
      }
    }

    if (dir === 'h') {
      let newOffset = diffX;
      // 边缘阻尼（首尾页拉拽时增加吃力感）
      if ((activeIndex === 0 && diffX > 0) || (activeIndex === TABS.length - 1 && diffX < 0)) {
        newOffset = diffX * 0.3;
      }
      setDragOffset(newOffset);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    if (!touchStartPos || swipeDir !== 'h') {
      setTouchStartPos(null);
      return;
    }

    // 滑动超过屏幕宽度 20% 触发翻页
    const threshold = window.innerWidth * 0.1; 
    if (dragOffset > threshold && activeIndex > 0) {
      setActiveTab(TABS[activeIndex - 1].id);
    } else if (dragOffset < -threshold && activeIndex < TABS.length - 1) {
      setActiveTab(TABS[activeIndex + 1].id);
    }

    setDragOffset(0);
    setTouchStartPos(null);
    setSwipeDir(null);
  };

  // ====== 提取单页内容渲染器（复用） ======
  const renderPostList = (tabId: string) => {
    const tabPosts = postsCache[tabId] || [];
    const isTabLoading = loadingState[tabId];

    return (
      // 移动端：去圆角(rounded-none)，只留上下边框(border-y, border-x-0)；PC端：恢复圆角和全边框
      <div className={`overflow-hidden rounded-none md:rounded-2xl border-y border-x-0 md:border ${currentTheme.border} ${currentTheme.card} w-full min-h-[50vh]`}>
        {isTabLoading && (
          <div className={`p-10 text-center text-sm ${currentTheme.textSub}`}>加载中...</div>
        )}

        {!isTabLoading && tabPosts.length === 0 && (
          <div className={`p-10 text-center text-sm ${currentTheme.textSub}`}>暂无内容</div>
        )}

        {!isTabLoading && tabPosts.map((post, index) => {
          const realId = post.id;
          if (!realId) return null;

          const topReply = post.topReply || null;
          const answerLink = topReply?.id ? `/forum/${topReply.id}?fromQuestion=${realId}` : `/forum/question/${realId}`;
          const answerVotes = topReply?.votes ?? post.votes ?? 0;
          const answerComments = topReply?.comments ?? post.comments ?? 0;
          const authorName = topReply?.author?.name || '暂无回答';
          const excerpt = topReply?.content || '这个问题还没有回答，点击查看并参与讨论。';

          return (
            <article
              key={realId}
              className={`px-4 md:px-6 py-4 md:py-5 ${index < tabPosts.length - 1 ? `border-b ${currentTheme.border}` : ''}`}
            >
              <Link href={`/forum/question/${realId}`} className="block">
                <h2
                  className={`font-bold leading-[1.42] tracking-tight ${currentTheme.textMain} hover:text-[var(--home-accent)] transition-colors`}
                  style={{ fontSize: `${fontSize + 4}px` }}
                >
                  {post.title}
                </h2>
              </Link>

              <div className="mt-3 flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full overflow-hidden flex items-center justify-center bg-[var(--home-soft)]`}>
                  {topReply?.author?.avatar ? (
                    <img src={topReply.author.avatar} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className={`text-[11px] font-semibold ${currentTheme.textSub}`}>
                      {authorName.slice(0, 1)}
                    </span>
                  )}
                </div>
                <span className={`text-sm font-medium ${currentTheme.textMain}`}>{authorName}</span>
              </div>

              <Link href={answerLink} className="block">
                <p
                  className={`mt-2 leading-[1.65] line-clamp-2 md:line-clamp-3 ${currentTheme.textSub} hover:text-[var(--home-text)] transition-colors`}
                  style={{ fontSize: `${fontSize}px` }}
                >
                  {excerpt}
                </p>
              </Link>

              <div className={`mt-3 flex items-center gap-5 text-[13px] ${currentTheme.textSub}`}>
                <span className="inline-flex items-center gap-1.5">
                  <ThumbsUp className="w-3.5 h-3.5" />
                  {formatCount(answerVotes)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MessageCircle className="w-3.5 h-3.5" />
                  {formatCount(answerComments)}
                </span>
                <span className="ml-auto text-xs">{topReply ? '查看回答' : '去回答'}</span>
              </div>
            </article>
          );
        })}
      </div>
    );
  };

// ====== 提取热榜页内容渲染器（纯文字版） ======
  const renderHotList = (tabId: string) => {
    const tabPosts = postsCache[tabId] || [];
    const isTabLoading = loadingState[tabId];

    return (
      <div className={`overflow-hidden rounded-none md:rounded-2xl border-y border-x-0 md:border ${currentTheme.border} ${currentTheme.card} w-full min-h-[50vh]`}>
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
    <div data-forum-theme="home" className={`forum-page min-h-screen ${currentTheme.bg} pb-24 md:pb-12 font-sans transition-colors duration-300`}>
      <div className="forum-masthead">
        <header className="mh-topbar">
          <Link href="/" className="mh-logo" aria-label="九天小说首页"><Image src="/icon.png" alt="九天小说" width={40} height={40} sizes="40px" priority/></Link>
          <form className="forum-search" role="search" onSubmit={event => event.preventDefault()}>
            <Search size={19} aria-hidden="true"/><input type="search" aria-label="搜索你想看的问题或文章" placeholder="搜索问题或文章" value={searchQuery} onChange={event => setSearchQuery(event.target.value)}/>
          </form>
        </header>
      </div>
      <div className={`forum-feed-toolbar ${currentTheme.card} ${currentTheme.border}`}>
          {/* 移动端: 选项卡均分宽度; PC端(md): 恢复靠左排布 */}
          <nav aria-label="论坛内容分类" className="-mb-px flex flex-1 min-w-0 justify-around md:justify-start items-center md:gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 md:flex-none flex justify-center items-center shrink-0 px-3 sm:px-4 h-11 border-b-2 text-[15px] font-semibold transition-colors ${isActive ? currentTheme.tabActive : currentTheme.tabIdle}`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
      </div>

      {/* 移动端: px-0 满屏, mt-1 缩短间隙; PC端(md): 恢复内边距和外边距 */}
      <div className="max-w-[1040px] mx-auto px-0 md:px-4 mt-0 md:mt-6 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_300px] gap-5 md:gap-6">
        
        {/* ================= 移动端独享：跟手轮播容器 ================= */}
        <div className="md:hidden w-full relative overflow-hidden" style={{ touchAction: 'pan-y' }}>
          <div 
            className={`flex w-full ${isDragging ? '' : 'transition-transform duration-300 ease-out'}`}
            style={{ transform: `translateX(calc(-${activeIndex * 100}% + ${dragOffset}px))` }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {TABS.map(tab => (
              <div key={tab.id} className="w-full shrink-0" inert={tab.id!==activeTab} aria-hidden={tab.id!==activeTab}>
                {/* 替换原有的 {renderPostList(tab.id)} */}
                {tab.id === 'hot' ? renderHotList(tab.id) : renderPostList(tab.id)}
              </div>
            ))}
          </div>
        </div>

{/* ================= PC端独享：传统单页直出，不参与任何滑动逻辑 ================= */}
        <div className="hidden md:block w-full">
          {/* 替换原有的 {renderPostList(activeTab)} */}
          {activeTab === 'hot' ? renderHotList(activeTab) : renderPostList(activeTab)}
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
