'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
// 🔥 1. 补全了 ThumbsUp 和其他需要的图标
import { 
  ArrowLeft, MoreHorizontal, ThumbsUp, MessageCircle, Share2, 
  Settings, User, ChevronRight, Moon, Sun, Type, X
} from 'lucide-react';
import { forumApi, ForumPost, ForumReply } from '@/lib/api';

// 🎨 定义两套主题配置
const THEMES = {
  light: {
    mode: 'light',
    bg: 'bg-[#f8f9fa]',       // 浅灰背景
    card: 'bg-white',         // 纯白卡片
    textMain: 'text-gray-900', // 主要文字
    textSub: 'text-gray-500',  // 次要文字
    border: 'border-gray-100', // 边框
    divider: 'border-gray-200',
    hover: 'hover:bg-gray-50',
    codeBg: 'bg-gray-100',     // 代码块/引用背景
    icon: 'text-gray-400 hover:text-gray-900',
    panel: 'bg-white/90 backdrop-blur-md border-gray-200 text-gray-900', // 设置面板
  },
  dark: {
    mode: 'dark',
    bg: 'bg-[#121212]',       // 深黑背景
    card: 'bg-[#1e1e1e]',     // 深灰卡片
    textMain: 'text-gray-200', // 浅灰文字
    textSub: 'text-gray-400',  // 暗灰文字
    border: 'border-[#2d2d2d]', // 暗色边框
    divider: 'border-[#333]',
    hover: 'hover:bg-[#2d2d2d]',
    codeBg: 'bg-[#2d2d2d]',
    icon: 'text-gray-500 hover:text-gray-200',
    panel: 'bg-[#1e1e1e]/90 backdrop-blur-md border-[#333] text-gray-200', // 设置面板
  }
};

function PostContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams(); 
  
  const rawId = params?.postId || params?.id;
  const postId = (Array.isArray(rawId) ? rawId[0] : rawId) as string;
  const fromQuestionId = searchParams.get('fromQuestion');

  // === ⚙️ 阅读设置状态 ===
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light');
  const [fontSize, setFontSize] = useState(17); // 默认 17px
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // 获取当前主题对象
  const currentTheme = THEMES[themeMode];

  // 数据状态
  const [question, setQuestion] = useState<ForumPost | null>(null);
  const [answer, setAnswer] = useState<ForumReply | null>(null);
  const [otherAnswers, setOtherAnswers] = useState<ForumReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // 点击外部关闭设置面板
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setShowSettings(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 数据获取逻辑 (保持不变)
  useEffect(() => {
    const fetchData = async () => {
      if (!postId || postId === 'undefined') return;
      try {
        setLoading(true);
        let finalQuestion = null;
        let finalAnswer = null;
        let allReplies: ForumReply[] = [];

        if (fromQuestionId && fromQuestionId !== 'undefined') {
            const [qData, replies] = await Promise.all([
                forumApi.getById(fromQuestionId),
                forumApi.getReplies(fromQuestionId)
            ]);
            finalQuestion = qData;
            allReplies = replies;
            finalAnswer = replies.find(r => r.id === postId) || null;
        } else {
            const postData = await forumApi.getById(postId); 
            finalQuestion = postData;
            if (postData.id) {
               try { allReplies = await forumApi.getReplies(postData.id); } catch (e) {}
            }
            finalAnswer = {
                id: postData.id,
                content: postData.content || '',
                votes: postData.votes,
                comments: postData.comments,
                time: postData.created_at || '',
                author: typeof postData.author === 'string' ? { name: postData.author, avatar: '' } : postData.author
            } as any;
        }

        if (finalQuestion) setQuestion(finalQuestion);
        if (finalAnswer) setAnswer(finalAnswer);

        if (allReplies.length > 0 && finalAnswer) {
            const others = allReplies
                .filter(r => r.id !== finalAnswer?.id)
                .sort((a, b) => (b.votes || 0) - (a.votes || 0));
            setOtherAnswers(others);
        }
      } catch (error: any) {
        setErrorMsg(error.message || '加载失败');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [postId, fromQuestionId]);

  if (loading) return <div className={`min-h-screen ${currentTheme.bg} pt-20 text-center ${currentTheme.textSub}`}>加载中...</div>;
  if (errorMsg) return <div className={`min-h-screen ${currentTheme.bg} flex items-center justify-center text-red-500`}>出错: {errorMsg}</div>;
  if (!answer || !question) return <div className={`min-h-screen ${currentTheme.bg} flex items-center justify-center ${currentTheme.textSub}`}>内容不存在</div>;

  return (
    // 应用动态背景色和字体
    <div className={`min-h-screen ${currentTheme.bg} pb-20 font-sans transition-colors duration-300`}>
      
      {/* === 顶部导航 === */}
      <div className={`sticky top-0 z-40 border-b transition-colors duration-300 ${themeMode === 'light' ? 'bg-white/90' : 'bg-[#121212]/90'} backdrop-blur-md ${currentTheme.border}`}>
        <div className="max-w-[800px] mx-auto px-4 h-16 flex items-center justify-between">
           <Link href="/forum" className={`${currentTheme.textSub} hover:${currentTheme.textMain} transition-colors flex items-center gap-1`}>
              <ArrowLeft className="w-5 h-5" /> 
              <span className="font-bold text-sm">首页</span>
           </Link>
           <div className="flex-1"></div>
           <div className="flex gap-2 relative">
              <button className={`p-2 ${currentTheme.icon}`}><Share2 className="w-5 h-5" /></button>
              
              {/* 设置按钮 */}
              <button 
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 transition-colors rounded-full ${showSettings ? 'bg-gray-100 text-gray-900 dark:bg-[#333] dark:text-white' : currentTheme.icon}`}
              >
                  <Settings className="w-5 h-5" />
              </button>

              {/* === 🛠️ 悬浮设置面板 === */}
              {showSettings && (
                <div 
                  ref={settingsRef}
                  className={`absolute right-0 top-12 w-64 p-4 rounded-xl border shadow-xl animate-in fade-in zoom-in-95 duration-200 origin-top-right z-50 ${currentTheme.panel}`}
                >
                   {/* 1. 主题切换 */}
                   <div className="mb-4">
                      <div className="text-xs font-bold opacity-60 mb-2 px-1">阅读主题</div>
                      <div className={`flex bg-black/5 p-1 rounded-lg ${themeMode === 'dark' ? 'bg-white/10' : ''}`}>
                          <button 
                            onClick={() => setThemeMode('light')}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${themeMode === 'light' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-400'}`}
                          >
                             <Sun className="w-4 h-4" /> 亮色
                          </button>
                          <button 
                             onClick={() => setThemeMode('dark')}
                             className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${themeMode === 'dark' ? 'bg-[#333] text-white shadow-sm' : 'text-gray-500 hover:text-gray-400'}`}
                          >
                             <Moon className="w-4 h-4" /> 暗色
                          </button>
                      </div>
                   </div>

                   {/* 2. 字号调节 */}
                   <div>
                      <div className="flex justify-between items-center mb-2 px-1">
                          <span className="text-xs font-bold opacity-60">正文字号</span>
                          <span className="text-xs opacity-60">{fontSize}px</span>
                      </div>
                      <div className={`flex items-center justify-between bg-black/5 p-2 rounded-lg ${themeMode === 'dark' ? 'bg-white/10' : ''}`}>
                          <button onClick={() => setFontSize(prev => Math.max(14, prev - 1))} className="p-1 hover:bg-black/10 rounded"><Type className="w-3 h-3" /></button>
                          {/* 进度条模拟 */}
                          <div className="flex gap-1">
                             {[14, 16, 17, 18, 20].map(size => (
                                 <div 
                                   key={size}
                                   onClick={() => setFontSize(size)}
                                   className={`h-2 w-2 rounded-full cursor-pointer transition-all ${fontSize >= size ? (themeMode === 'light' ? 'bg-black' : 'bg-white') : 'bg-gray-300 opacity-30'}`}
                                 ></div>
                             ))}
                          </div>
                          <button onClick={() => setFontSize(prev => Math.min(24, prev + 1))} className="p-1 hover:bg-black/10 rounded"><Type className="w-5 h-5" /></button>
                      </div>
                   </div>
                </div>
              )}
           </div>
        </div>
      </div>

      <div className="max-w-[800px] mx-auto mt-8 px-4 md:px-0">
          
          {/* 标题 */}
          <div className="mb-8">
              <Link href={`/forum/question/${question.id}`}>
                <h1 className={`text-3xl font-bold ${currentTheme.textMain} leading-tight mb-4 tracking-tight hover:text-blue-600 transition-colors cursor-pointer group`}>
                    {question.title}
                    <ChevronRight className="inline-block w-6 h-6 ml-1 text-gray-400 group-hover:text-blue-600 transition-colors mb-1" />
                </h1>
              </Link>

              <div className="flex gap-2">
                  {question.tags?.map((tag: string) => (
                      <span key={tag} className={`${currentTheme.card} border ${currentTheme.border} ${currentTheme.textSub} px-2 py-0.5 rounded text-xs font-medium`}>
                         {tag}
                      </span>
                  ))}
              </div>
          </div>

          {/* === 当前主要回答 === */}
          <article className={`${currentTheme.card} p-8 md:p-10 shadow-sm rounded-xl border ${currentTheme.border} mb-12 transition-colors duration-300`}>
              <div className={`flex items-center justify-between mb-8 pb-6 border-b ${currentTheme.divider}`}>
                  <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-full ${currentTheme.codeBg} flex items-center justify-center overflow-hidden`}>
                          {answer.author?.avatar ? (
                                <img src={answer.author.avatar} className="w-full h-full object-cover" />
                            ) : (
                                <User className={`w-6 h-6 ${currentTheme.textSub}`} />
                            )}
                      </div>
                      <div>
                          <div className={`font-bold ${currentTheme.textMain} text-base`}>{answer.author?.name}</div>
                          <div className={`text-xs ${currentTheme.textSub} mt-0.5`}>{answer.author?.bio || '暂无介绍'}</div>
                      </div>
                  </div>
                  <button className={`${themeMode === 'light' ? 'bg-gray-100 text-gray-900 hover:bg-gray-200' : 'bg-[#333] text-gray-200 hover:bg-[#444]'} px-5 py-1.5 rounded-full text-sm font-bold transition-colors`}>
                      关注
                  </button>
              </div>

              {/* 正文：动态字号 + 动态颜色 */}
              <div 
                style={{ fontSize: `${fontSize}px` }}
                className={`rich-text-content ${currentTheme.textMain} leading-[1.8] font-normal tracking-wide space-y-6 transition-all duration-200`} 
                dangerouslySetInnerHTML={{ __html: answer.content }}
              ></div>
              
              <div className={`mt-12 pt-8 border-t ${currentTheme.divider} flex items-center justify-between`}>
                  <div className={`text-sm ${currentTheme.textSub}`}>
                      发布于 {new Date(answer.time).toLocaleDateString()}
                  </div>
                  <div className="flex gap-6">
                       <button className={`flex items-center gap-2 ${currentTheme.icon} transition-colors`}>
                          <ThumbsUp className="w-5 h-5" /> <span className="font-bold">{answer.votes || 0}</span>
                       </button>
                       <button className={`flex items-center gap-2 ${currentTheme.icon} transition-colors`}>
                          <MessageCircle className="w-5 h-5" /> <span className="font-bold">{answer.comments || 0}</span>
                       </button>
                  </div>
              </div>
          </article>

          {/* === 其他回答 (流式展示) === */}
          {otherAnswers.length > 0 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                
                {/* 分割线 */}
                <div className="relative flex items-center justify-center mb-10">
                    <div className="absolute inset-0 flex items-center">
                        <div className={`w-full border-t ${currentTheme.divider}`}></div>
                    </div>
                    <div className={`relative ${currentTheme.bg} px-4 transition-colors duration-300`}>
                        <span className={`text-sm font-bold ${currentTheme.textSub}`}>更多回答 ({otherAnswers.length})</span>
                    </div>
                </div>

                <div className="flex flex-col gap-8">
                    {otherAnswers.map(item => (
                        <article 
                            key={item.id}
                            className={`${currentTheme.card} p-8 md:p-10 shadow-sm rounded-xl border ${currentTheme.border} transition-colors duration-300`}
                        >
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-full ${currentTheme.codeBg} flex items-center justify-center overflow-hidden`}>
                                        {item.author?.avatar ? (
                                            <img src={item.author.avatar} alt="avatar" className="w-full h-full object-cover"/>
                                        ) : (
                                            <span className={`${currentTheme.textSub} font-bold text-sm`}>{item.author?.name?.[0]}</span>
                                        )}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className={`text-sm font-bold ${currentTheme.textMain}`}>{item.author?.name}</span>
                                        <span className={`text-xs ${currentTheme.textSub}`}>{item.time.split(' ')[0]}</span>
                                    </div>
                                </div>
                            </div>
                            
                            {/* 其他回答也应用设置的字号，但稍微减小一点点以示区分，或者保持一致 */}
                            <div 
                                style={{ fontSize: `${fontSize}px` }}
                                className={`rich-text-content ${currentTheme.textMain} leading-[1.8] font-normal tracking-wide space-y-4 transition-all duration-200`}
                                dangerouslySetInnerHTML={{ __html: item.content }}
                            ></div>

                            <div className={`mt-8 pt-6 border-t ${currentTheme.divider} flex items-center gap-6 ${currentTheme.textSub}`}>
                                <button className={`flex items-center gap-2 hover:${currentTheme.textMain} transition-colors`}>
                                    <ThumbsUp className="w-4 h-4" /> <span className="text-sm font-bold">{item.votes}</span>
                                </button>
                                <button className={`flex items-center gap-2 hover:${currentTheme.textMain} transition-colors`}>
                                    <MessageCircle className="w-4 h-4" /> <span className="text-sm font-bold">{item.comments}</span>
                                </button>
                            </div>
                        </article>
                    ))}
                </div>
                
                <div className={`py-12 text-center ${currentTheme.textSub} text-sm opacity-60`}>
                    - 已加载全部回答 -
                </div>
            </div>
          )}

          <div className="h-10"></div>
      </div>
    </div>
  );
}

export default function PostDetailPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
       <PostContent />
    </Suspense>
  );
}