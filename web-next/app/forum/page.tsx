'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Feather, HelpCircle, Moon, Scroll, Search, Settings, Sun, Type } from 'lucide-react';
import { forumApi, ForumPost } from '@/lib/api';

type ThemeMode = 'light' | 'dark';

const READER_SETTINGS_KEY = 'forum_reader_settings_v1';

const HOT_TOPICS = [
  '南京博物院事件最新官方通报',
  '追梦者飞船最新测试成功',
  '日本众议院选举投票结束',
  'Seedance 2.0 影视工作流讨论',
  '黑神话钟馗首曝实机画面'
];

const THEMES = {
  light: {
    bg: 'bg-[#f8f9fa]',
    card: 'bg-white',
    textMain: 'text-gray-900',
    textSub: 'text-gray-500',
    border: 'border-gray-100',
    icon: 'text-gray-400 hover:text-gray-900',
    panel: 'bg-white/95 border-gray-200 text-gray-900'
  },
  dark: {
    bg: 'bg-[#121212]',
    card: 'bg-[#1e1e1e]',
    textMain: 'text-gray-100',
    textSub: 'text-gray-400',
    border: 'border-[#2d2d2d]',
    icon: 'text-gray-500 hover:text-gray-200',
    panel: 'bg-[#1e1e1e]/95 border-[#333] text-gray-100'
  }
};

export default function ForumPage() {
  const [activeTab, setActiveTab] = useState<'recommend' | 'hot' | 'follow'>('recommend');
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
        console.error('获取论坛列表失败:', error);
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
      // 忽略无效缓存
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify({ themeMode, fontSize }));
    } catch {
      // 忽略写入失败
    }
  }, [themeMode, fontSize]);

  return (
    <div className={`min-h-screen ${currentTheme.bg} pb-10 font-sans transition-colors duration-300`}>
      <div className={`sticky top-0 z-30 backdrop-blur-md border-b ${currentTheme.border} ${themeMode === 'light' ? 'bg-white/85' : 'bg-[#121212]/85'}`}>
        <div className="max-w-[1000px] mx-auto px-4 h-16 flex items-center justify-between">
          <div className="w-10">
            <button className={`p-2 transition-colors ${currentTheme.icon}`} title="搜索">
              <Search className="w-5 h-5" />
            </button>
          </div>

          <nav className="flex items-center gap-10 h-full">
            {[
              { id: 'follow', label: '关注' },
              { id: 'recommend', label: '推荐' },
              { id: 'hot', label: '热榜' }
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as 'recommend' | 'hot' | 'follow')}
                  className={`relative h-full flex items-center px-1 text-[16px] transition-colors duration-200 ${isActive ? (themeMode === 'light' ? 'text-gray-900 font-bold' : 'text-gray-100 font-bold') : 'text-gray-500 hover:text-gray-800'}`}
                >
                  {tab.label}
                  {isActive && <div className={`absolute bottom-0 left-0 w-full h-[2px] rounded-full ${themeMode === 'light' ? 'bg-gray-900' : 'bg-gray-100'}`}></div>}
                </button>
              );
            })}
          </nav>

          <div className="w-10 flex justify-end relative" ref={settingsRef}>
            <button
              onClick={() => setShowSettings(prev => !prev)}
              className={`p-2 transition-colors rounded-full ${showSettings ? 'bg-gray-100 text-gray-900' : currentTheme.icon}`}
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
                    <button onClick={() => setFontSize(prev => Math.max(14, prev - 1))} className="p-1 rounded hover:bg-black/10">
                      <Type className="w-3 h-3" />
                    </button>
                    <div className="flex gap-1">
                      {[14, 16, 18, 20, 22].map(size => (
                        <div
                          key={size}
                          onClick={() => setFontSize(size)}
                          className={`h-2 w-2 rounded-full cursor-pointer ${fontSize >= size ? (themeMode === 'light' ? 'bg-black' : 'bg-white') : 'bg-gray-400/40'}`}
                        ></div>
                      ))}
                    </div>
                    <button onClick={() => setFontSize(prev => Math.min(24, prev + 1))} className="p-1 rounded hover:bg-black/10">
                      <Type className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[1000px] mx-auto px-4 md:px-0 mt-6 grid grid-cols-1 md:grid-cols-[1fr_296px] gap-6">
        <div className="flex flex-col gap-4">
          {loading && (
            <div className={`${currentTheme.card} p-12 text-center ${currentTheme.textSub} border ${currentTheme.border} rounded-xl`}>
              加载中...
            </div>
          )}

          {!loading && posts.map((post) => {
            const realId = post.id;
            if (!realId) return null;

            const topReply = post.topReply || null;
            const answerLink = topReply?.id
              ? `/forum/${topReply.id}?fromQuestion=${realId}`
              : `/forum/question/${realId}`;
            const answerVotes = topReply?.votes ?? post.votes ?? 0;
            const answerComments = topReply?.comments ?? post.comments ?? 0;

            return (
              <div
                key={realId}
                className={`${currentTheme.card} p-6 rounded-xl border border-transparent hover:border-gray-200 shadow-sm hover:shadow-lg transition-all duration-300 group`}
              >
                <Link href={`/forum/question/${realId}`}>
                  <h2
                    className={`font-bold ${currentTheme.textMain} mb-2 leading-snug cursor-pointer group-hover:text-blue-600 transition-colors`}
                    style={{ fontSize: `${fontSize + 3}px` }}
                  >
                    {post.title}
                  </h2>
                </Link>

                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-7 h-7 rounded-full overflow-hidden flex items-center justify-center ${themeMode === 'light' ? 'bg-gray-100' : 'bg-[#2d2d2d]'}`}>
                    {topReply?.author?.avatar ? (
                      <img src={topReply.author.avatar} alt="头像" className="w-full h-full object-cover" />
                    ) : (
                      <span className={`text-[11px] font-semibold ${currentTheme.textSub}`}>
                        {(topReply?.author?.name || '匿').slice(0, 1)}
                      </span>
                    )}
                  </div>
                  <span className={`text-sm font-medium ${currentTheme.textMain}`}>
                    {topReply?.author?.name || '暂未回答'}
                  </span>
                  <span className={`text-xs ${currentTheme.textSub}`}>
                    {topReply ? '已回答' : ''}
                  </span>
                </div>

                <Link href={answerLink}>
                  <div
                    className={`leading-relaxed mb-4 cursor-pointer line-clamp-3 transition-colors ${currentTheme.textSub} ${themeMode === 'light' ? 'hover:text-gray-800' : 'hover:text-gray-100'}`}
                    style={{ fontSize: `${fontSize}px` }}
                  >
                    {topReply?.content || '这个问题还没有回答，点击查看并参与讨论。'}
                  </div>
                </Link>

                <div className="flex items-center justify-between">
                  <div className={`flex items-center gap-5 text-xs font-medium ${currentTheme.textSub}`}>
                    <span>{answerVotes > 1000 ? `${(answerVotes / 1000).toFixed(1)}k` : answerVotes} 赞同</span>
                    <span>{answerComments} 评论</span>
                  </div>
                </div>
              </div>
            );
          })}

          {!loading && posts.length === 0 && (
            <div className={`${currentTheme.card} p-12 text-center ${currentTheme.textSub} rounded-xl border ${currentTheme.border}`}>
              暂无内容。
            </div>
          )}
        </div>

        <div className="hidden md:flex flex-col gap-6">
          <div className={`${currentTheme.card} rounded-xl border ${currentTheme.border} p-5 shadow-sm`}>
            <div className="flex items-center justify-between mb-5">
              <span className={`text-sm font-bold ${currentTheme.textMain}`}>创作中心</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Link href="/forum/create?type=question" className="flex flex-col items-center justify-center gap-2 py-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors group cursor-pointer">
                <HelpCircle className="w-5 h-5 text-gray-600 group-hover:text-gray-900" />
                <span className="text-xs text-gray-600 font-medium">提问</span>
              </Link>

              <Link href="/forum/create?type=article" className="flex flex-col items-center justify-center gap-2 py-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors group cursor-pointer">
                <Scroll className="w-5 h-5 text-gray-600 group-hover:text-gray-900" />
                <span className="text-xs text-gray-600 font-medium">文章</span>
              </Link>
            </div>

            <Link href="/forum/create?type=article" className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-black transition-all shadow-md hover:shadow-lg">
              <Feather className="w-3.5 h-3.5" /> 开始创作
            </Link>
          </div>

          <div className={`${currentTheme.card} rounded-xl border ${currentTheme.border} p-5 shadow-sm`}>
            <h3 className={`font-bold text-sm mb-4 ${currentTheme.textMain}`}>热门话题</h3>
            <ul className="flex flex-col gap-3">
              {HOT_TOPICS.map((topic, index) => (
                <li key={index} className="flex items-start gap-3 cursor-pointer group">
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
        </div>
      </div>
    </div>
  );
}
