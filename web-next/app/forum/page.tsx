'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Feather,
  HelpCircle,
  MessageCircle,
  Moon,
  Plus,
  Scroll,
  Search,
  Settings,
  Sun,
  ThumbsUp,
  Type
} from 'lucide-react';
import { forumApi, ForumPost } from '@/lib/api';

type ThemeMode = 'light' | 'dark';
type FeedTab = 'recommend' | 'hot' | 'follow';

const READER_SETTINGS_KEY = 'forum_reader_settings_v1';

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

const THEMES = {
  light: {
    bg: 'bg-[#f5f6f7]',
    card: 'bg-white',
    textMain: 'text-[#1f2329]',
    textSub: 'text-[#646a73]',
    border: 'border-[#e6e8eb]',
    icon: 'text-[#8a8f98] hover:text-[#1f2329]',
    panel: 'bg-white/95 border-[#e1e4e8] text-[#1f2329]',
    tabActive: 'text-[#111827] border-[#111827]',
    tabIdle: 'text-[#7a8088] border-transparent hover:text-[#1f2329]',
    chipBg: 'bg-[#f2f4f6]',
    chipHover: 'hover:bg-[#ebedf0]'
  },
  dark: {
    bg: 'bg-[#121417]',
    card: 'bg-[#1c2026]',
    textMain: 'text-[#f4f6f8]',
    textSub: 'text-[#9ea4ad]',
    border: 'border-[#30353c]',
    icon: 'text-[#7f8791] hover:text-[#edf1f4]',
    panel: 'bg-[#1f242b]/95 border-[#343a42] text-[#f4f6f8]',
    tabActive: 'text-[#edf1f4] border-[#edf1f4]',
    tabIdle: 'text-[#8d949d] border-transparent hover:text-[#edf1f4]',
    chipBg: 'bg-[#2a3038]',
    chipHover: 'hover:bg-[#323942]'
  }
};

function formatCount(value: number) {
  if (!value) return '0';
  if (value >= 10000) return `${(value / 10000).toFixed(1)}w`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export default function ForumPage() {
  const [activeTab, setActiveTab] = useState<FeedTab>('recommend');
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const [fontSize, setFontSize] = useState(16);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const currentTheme = THEMES[themeMode];

  useEffect(() => {
    const fetchPosts = async () => {
      try {
        setLoading(true);
        const data = await forumApi.getPosts(activeTab);
        setPosts(data || []);
      } catch (error) {
        console.error('Failed to fetch forum posts:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchPosts();
  }, [activeTab]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(READER_SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.themeMode === 'light' || parsed?.themeMode === 'dark') {
        setThemeMode(parsed.themeMode);
      }
      if (typeof parsed?.fontSize === 'number' && parsed.fontSize >= 14 && parsed.fontSize <= 24) {
        setFontSize(parsed.fontSize);
      }
    } catch {
      // ignore invalid cache
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify({ themeMode, fontSize }));
    } catch {
      // ignore write failure
    }
  }, [themeMode, fontSize]);

  return (
    <div className={`min-h-screen ${currentTheme.bg} pb-24 md:pb-12 font-sans transition-colors duration-300`}>
      <div
        className={`sticky top-0 z-40 border-b backdrop-blur-md ${currentTheme.border} ${themeMode === 'light' ? 'bg-white/90' : 'bg-[#121417]/90'}`}
      >
        <div className="max-w-[1040px] mx-auto px-4">
          <div className="h-14 flex items-center justify-between">
            <span className={`text-lg font-bold tracking-tight ${currentTheme.textMain}`}>论坛</span>

            <div className="relative flex items-center gap-1" ref={settingsRef}>
              <button className={`p-2 transition-colors rounded-full ${currentTheme.icon}`} title="搜索">
                <Search className="w-5 h-5" />
              </button>
              <button
                onClick={() => setShowSettings((prev) => !prev)}
                className={`p-2 transition-colors rounded-full ${showSettings ? (themeMode === 'light' ? 'bg-gray-100 text-gray-900' : 'bg-[#2f353d] text-white') : currentTheme.icon}`}
                title="阅读设置"
              >
                <Settings className="w-5 h-5" />
              </button>

              {showSettings && (
                <div className={`absolute right-0 top-12 w-64 p-4 rounded-xl border shadow-xl z-50 ${currentTheme.panel}`}>
                  <div className="mb-4">
                    <div className="text-xs font-bold opacity-70 mb-2 px-1">主题</div>
                    <div className={`flex p-1 rounded-lg ${themeMode === 'light' ? 'bg-gray-100' : 'bg-white/10'}`}>
                      <button
                        onClick={() => setThemeMode('light')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium ${themeMode === 'light' ? 'bg-white text-black shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                      >
                        <Sun className="w-4 h-4" /> 浅色
                      </button>
                      <button
                        onClick={() => setThemeMode('dark')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium ${themeMode === 'dark' ? 'bg-[#333] text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                      >
                        <Moon className="w-4 h-4" /> 深色
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2 px-1">
                      <span className="text-xs font-bold opacity-70">字号</span>
                      <span className="text-xs opacity-70">{fontSize}px</span>
                    </div>
                    <div className={`flex items-center justify-between p-2 rounded-lg ${themeMode === 'light' ? 'bg-gray-100' : 'bg-white/10'}`}>
                      <button onClick={() => setFontSize((prev) => Math.max(14, prev - 1))} className="p-1 rounded hover:bg-black/10">
                        <Type className="w-3 h-3" />
                      </button>
                      <div className="flex gap-1">
                        {[14, 16, 18, 20, 22].map((size) => (
                          <button
                            key={size}
                            onClick={() => setFontSize(size)}
                            className={`h-2 w-2 rounded-full ${fontSize >= size ? (themeMode === 'light' ? 'bg-black' : 'bg-white') : 'bg-gray-400/40'}`}
                            aria-label={`字号 ${size}`}
                          />
                        ))}
                      </div>
                      <button onClick={() => setFontSize((prev) => Math.min(24, prev + 1))} className="p-1 rounded hover:bg-black/10">
                        <Type className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <nav className="-mb-px flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`shrink-0 px-3 sm:px-4 h-11 border-b-2 text-[15px] font-semibold transition-colors ${isActive ? currentTheme.tabActive : currentTheme.tabIdle}`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="max-w-[1040px] mx-auto px-4 mt-3 md:mt-6 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_300px] gap-5 md:gap-6">
        <div className={`overflow-hidden rounded-2xl border ${currentTheme.border} ${currentTheme.card}`}>
          {loading && (
            <div className={`p-10 text-center text-sm ${currentTheme.textSub}`}>加载中...</div>
          )}

          {!loading && posts.length === 0 && (
            <div className={`p-10 text-center text-sm ${currentTheme.textSub}`}>暂无内容</div>
          )}

          {!loading &&
            posts.map((post, index) => {
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
                  className={`px-4 md:px-6 py-4 md:py-5 ${index < posts.length - 1 ? `border-b ${currentTheme.border}` : ''}`}
                >
                  <Link href={`/forum/question/${realId}`} className="block">
                    <h2
                      className={`font-bold leading-[1.42] tracking-tight ${currentTheme.textMain} hover:text-blue-600 transition-colors`}
                      style={{ fontSize: `${fontSize + 4}px` }}
                    >
                      {post.title}
                    </h2>
                  </Link>

                  <div className="mt-3 flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full overflow-hidden flex items-center justify-center ${themeMode === 'light' ? 'bg-gray-100' : 'bg-[#2c323a]'}`}>
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
                      className={`mt-2 leading-[1.65] line-clamp-2 md:line-clamp-3 ${currentTheme.textSub} hover:text-gray-700 transition-colors`}
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
                <HelpCircle className="w-5 h-5 text-gray-600 group-hover:text-gray-900" />
                <span className="text-xs text-gray-600 font-medium">提问</span>
              </Link>

              <Link
                href="/forum/create?type=article"
                className={`flex flex-col items-center justify-center gap-2 py-4 rounded-xl transition-colors group cursor-pointer ${currentTheme.chipBg} ${currentTheme.chipHover}`}
              >
                <Scroll className="w-5 h-5 text-gray-600 group-hover:text-gray-900" />
                <span className="text-xs text-gray-600 font-medium">文章</span>
              </Link>
            </div>

            <Link
              href="/forum/create?type=article"
              className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 bg-gray-900 text-white text-sm rounded-xl hover:bg-black transition-all shadow-md hover:shadow-lg"
            >
              <Feather className="w-3.5 h-3.5" /> 开始创作
            </Link>
          </div>

          <div className={`${currentTheme.card} rounded-2xl border ${currentTheme.border} p-5 shadow-sm`}>
            <h3 className={`font-bold text-sm mb-4 ${currentTheme.textMain}`}>热门话题</h3>
            <ul className="flex flex-col gap-3">
              {HOT_TOPICS.map((topic, index) => (
                <li key={topic} className="flex items-start gap-3 cursor-pointer group">
                  <span className={`text-[15px] font-bold w-4 text-center leading-5 ${index < 3 ? 'text-gray-900' : 'text-gray-300'}`}>
                    {index + 1}
                  </span>
                  <span className="text-[14px] text-gray-700 leading-snug group-hover:text-blue-600 group-hover:underline line-clamp-2">
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
        className="md:hidden fixed right-4 bottom-6 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 bg-[#1677ff] text-white shadow-lg shadow-blue-500/30"
      >
        <Plus className="w-5 h-5" />
        <span className="text-sm font-semibold">发布</span>
      </Link>
    </div>
  );
}
