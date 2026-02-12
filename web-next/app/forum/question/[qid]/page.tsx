'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronDown,
  MessageCircle,
  Moon,
  Plus,
  Send,
  Settings,
  Sun,
  ThumbsUp,
  Type,
  User
} from 'lucide-react';
import { forumApi, ForumPost, ForumReply } from '@/lib/api';

type ThemeMode = 'light' | 'dark';

const READER_SETTINGS_KEY = 'forum_reader_settings_v1';

const THEMES = {
  light: {
    bg: 'bg-[#f8f9fa]',
    card: 'bg-white',
    textMain: 'text-gray-900',
    textSub: 'text-gray-500',
    border: 'border-gray-100',
    icon: 'text-gray-400 hover:text-gray-900',
    panel: 'bg-white/95 border-gray-200 text-gray-900',
    secondaryBtn: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50',
  },
  dark: {
    bg: 'bg-[#121212]',
    card: 'bg-[#1e1e1e]',
    textMain: 'text-gray-100',
    textSub: 'text-gray-400',
    border: 'border-[#2d2d2d]',
    icon: 'text-gray-500 hover:text-gray-200',
    panel: 'bg-[#1e1e1e]/95 border-[#333] text-gray-100',
    secondaryBtn: 'bg-[#1f1f1f] text-gray-200 border border-[#333] hover:bg-[#242424]',
  }
};

function QuestionSkeleton({ themeMode }: { themeMode: ThemeMode }) {
  const theme = THEMES[themeMode];
  return (
    <div className={`${theme.card} p-8 rounded-xl shadow-sm animate-pulse border ${theme.border}`}>
      <div className="h-8 bg-gray-200/70 rounded-md w-3/4 mb-6"></div>
      <div className="h-4 bg-gray-200/70 rounded w-full mb-3"></div>
      <div className="h-4 bg-gray-200/70 rounded w-full mb-3"></div>
      <div className="h-4 bg-gray-200/70 rounded w-2/3 mb-8"></div>
      <div className={`flex gap-4 pt-6 border-t ${theme.border}`}>
        <div className="h-10 bg-gray-200/70 rounded-lg w-28"></div>
        <div className="h-10 bg-gray-200/70 rounded-lg w-28"></div>
      </div>
    </div>
  );
}

export default function QuestionPage() {
  const router = useRouter();
  const params = useParams();
  const qid = params?.qid as string;

  const [question, setQuestion] = useState<ForumPost | null>(null);
  const [answers, setAnswers] = useState<ForumReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const [fontSize, setFontSize] = useState(16);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const theme = THEMES[themeMode];

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
      // ignore broken settings
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify({ themeMode, fontSize }));
    } catch {
      // ignore write failure
    }
  }, [themeMode, fontSize]);

  useEffect(() => {
    if (!qid) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        const [qData, rData] = await Promise.all([
          forumApi.getById(qid),
          forumApi.getReplies(qid)
        ]);
        setQuestion(qData);
        setAnswers(rData);
      } catch (error) {
        console.error('加载失败:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [qid]);

  const handleSubmitReply = async () => {
    if (!replyContent.trim()) {
      alert('请输入回答内容');
      return;
    }

    if (replyContent.trim().length > 12000) {
      alert('回答内容不能超过 12000 字');
      return;
    }

    setIsSubmitting(true);
    try {
      await forumApi.addReply(qid, { content: replyContent.replace(/\n/g, '<br/>') });
      setReplyContent('');
      setShowEditor(false);
      const newAnswers = await forumApi.getReplies(qid);
      setAnswers(newAnswers);
    } catch (error: any) {
      if (error.message?.includes('401') || error.message?.includes('403')) {
        alert('请先登录后再回答');
        router.push('/login');
      } else {
        alert(`发布失败：${error.message || '请稍后重试'}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`min-h-screen ${theme.bg} pb-20 font-sans transition-colors duration-300`}>
      <div className={`sticky top-0 z-30 backdrop-blur-md border-b ${theme.border} ${themeMode === 'light' ? 'bg-white/85' : 'bg-[#121212]/85'}`}>
        <div className="max-w-[1000px] mx-auto px-4 h-16 flex items-center justify-between">
          <button onClick={() => router.back()} className={`${theme.textSub} ${themeMode === 'light' ? 'hover:text-gray-900' : 'hover:text-gray-100'} transition-colors flex items-center gap-2`}>
            <ArrowLeft className="w-5 h-5" />
          </button>

          <span className={`font-bold truncate max-w-[500px] text-center text-[15px] opacity-90 ${theme.textMain}`}>
            {loading ? '加载中...' : question?.title}
          </span>

          <div className="relative" ref={settingsRef}>
            <button onClick={() => setShowSettings(prev => !prev)} className={`${theme.icon} transition-colors p-1`}>
              <Settings className="w-5 h-5" />
            </button>

            {showSettings && (
              <div className={`absolute right-0 top-10 w-64 p-4 rounded-xl border shadow-xl z-50 ${theme.panel}`}>
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

      <div className="max-w-[1000px] mx-auto mt-6 px-4 md:px-0">
        {loading ? (
          <QuestionSkeleton themeMode={themeMode} />
        ) : !question ? (
          <div className={`${theme.card} p-12 text-center ${theme.textSub} rounded-xl border ${theme.border}`}>问题不存在</div>
        ) : (
          <>
            <div className={`${theme.card} mb-6 p-8 rounded-xl shadow-sm border ${theme.border}`}>
              <div className="flex gap-2 mb-4">
                {question.tags?.map((tag: string) => (
                  <span key={tag} className={`${themeMode === 'light' ? 'bg-gray-100 text-gray-600' : 'bg-[#2a2a2a] text-gray-300'} px-3 py-1 rounded-md text-xs font-medium`}>
                    {tag}
                  </span>
                ))}
              </div>

              <h1 className={`font-bold mb-6 leading-tight tracking-tight ${theme.textMain}`} style={{ fontSize: `${fontSize + 10}px` }}>
                {question.title}
              </h1>

              <div
                className={`${theme.textMain} leading-relaxed mb-8`}
                style={{ fontSize: `${fontSize}px` }}
                dangerouslySetInnerHTML={{ __html: question.content || '' }}
              />

              <div className={`flex items-center justify-between border-t pt-6 ${theme.border}`}>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowEditor(!showEditor)}
                    className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${showEditor ? 'bg-gray-100 text-gray-600' : 'bg-gray-900 text-white hover:bg-black shadow-md hover:shadow-lg'}`}
                  >
                    {showEditor ? '收起回答框' : '写回答'}
                  </button>
                  <button className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${theme.secondaryBtn}`}>
                    <Plus className="w-4 h-4" /> 关注问题
                  </button>
                </div>
                <div className={`text-xs font-medium ${theme.textSub}`}>
                  {question.views || 0} 浏览 · {question.comments || 0} 讨论
                </div>
              </div>

              {showEditor && (
                <div className="mt-6 animate-in fade-in slide-in-from-top-2">
                  <div className={`border rounded-xl overflow-hidden shadow-sm ${theme.border} ${theme.card}`}>
                    <textarea
                      className={`w-full h-40 p-4 outline-none resize-none leading-relaxed ${theme.card} ${theme.textMain}`}
                      placeholder="开始写你的回答...（Ctrl + Enter 快速发布）"
                      style={{ fontSize: `${fontSize}px` }}
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.ctrlKey && e.key === 'Enter') {
                          e.preventDefault();
                          handleSubmitReply();
                        }
                      }}
                    />
                    <div className={`px-4 py-3 flex justify-between items-center border-t ${theme.border} ${themeMode === 'light' ? 'bg-gray-50' : 'bg-[#222]'}`}>
                      <span className={`text-xs ${theme.textSub}`}>支持换行排版</span>
                      <div className="flex gap-3">
                        <button onClick={() => setShowEditor(false)} className={`${theme.textSub} text-sm px-3 ${themeMode === 'light' ? 'hover:text-gray-900' : 'hover:text-gray-100'}`}>
                          取消
                        </button>
                        <button
                          onClick={handleSubmitReply}
                          disabled={isSubmitting}
                          className="bg-gray-900 text-white text-sm px-5 py-2 rounded-lg disabled:opacity-50 flex items-center gap-2 hover:bg-black transition-colors shadow-sm"
                        >
                          {isSubmitting ? '提交中...' : <><Send className="w-3 h-3" /> 发布回答</>}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center px-2 pb-3">
              <span className={`font-bold text-base ${theme.textMain}`}>{answers.length} 个回答</span>
              <span className={`flex items-center gap-1 text-sm cursor-pointer ${theme.textSub}`}>
                默认排序 <ChevronDown className="w-4 h-4" />
              </span>
            </div>

            <div className="flex flex-col gap-4">
              {answers.map((answer) => (
                <Link
                  href={`/forum/${answer.id}?fromQuestion=${question.id}`}
                  key={answer.id}
                  className={`${theme.card} p-6 rounded-xl shadow-sm border border-transparent hover:border-gray-200 hover:shadow-md transition-all duration-300 block group`}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center overflow-hidden ${themeMode === 'light' ? 'bg-gray-100 border border-gray-50' : 'bg-[#2d2d2d] border border-[#333]'}`}>
                      {answer.author?.avatar ? (
                        <img src={answer.author.avatar} alt="头像" className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                    <span className={`text-sm font-bold ${theme.textMain}`}>{answer.author?.name || '匿名用户'}</span>
                  </div>

                  <div
                    className={`leading-relaxed mb-4 line-clamp-3 group-hover:text-gray-900 transition-colors ${theme.textSub}`}
                    style={{ fontSize: `${fontSize}px` }}
                    dangerouslySetInnerHTML={{ __html: answer.content }}
                  ></div>

                  <div className={`flex items-center gap-6 text-sm font-medium ${theme.textSub}`}>
                    <span className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-100 hover:text-blue-600 transition-colors">
                      <ThumbsUp className="w-4 h-4" /> {answer.votes || 0} 赞同
                    </span>
                    <span className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-100 hover:text-blue-600 transition-colors">
                      <MessageCircle className="w-4 h-4" /> {answer.comments || 0} 评论
                    </span>
                    <span className="text-xs ml-auto text-gray-300">{answer.time.split(' ')[0]}</span>
                  </div>
                </Link>
              ))}

              {answers.length === 0 && (
                <div className={`py-12 text-center ${theme.textSub}`}>暂时还没有回答，来做第一个回答者吧。</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
