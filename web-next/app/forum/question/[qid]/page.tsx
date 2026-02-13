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
    bg: 'bg-[#f5f6f7]',
    card: 'bg-white',
    textMain: 'text-[#1f2329]',
    textSub: 'text-[#646a73]',
    border: 'border-[#e6e8eb]',
    icon: 'text-[#8a8f98] hover:text-[#1f2329]',
    panel: 'bg-white/95 border-[#e1e4e8] text-[#1f2329]',
    secondaryBtn: 'bg-white text-[#505866] border border-[#dce1e7] hover:bg-[#f7f8fa]'
  },
  dark: {
    bg: 'bg-[#121417]',
    card: 'bg-[#1c2026]',
    textMain: 'text-[#f4f6f8]',
    textSub: 'text-[#9ea4ad]',
    border: 'border-[#30353c]',
    icon: 'text-[#7f8791] hover:text-[#edf1f4]',
    panel: 'bg-[#1f242b]/95 border-[#343a42] text-[#f4f6f8]',
    secondaryBtn: 'bg-[#20252c] text-[#cfd5dd] border border-[#343a42] hover:bg-[#2a3038]'
  }
};

function formatCount(value: number) {
  if (!value) return '0';
  if (value >= 10000) return `${(value / 10000).toFixed(1)}w`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function QuestionSkeleton({ themeMode }: { themeMode: ThemeMode }) {
  const theme = THEMES[themeMode];
  return (
    <div className={`${theme.card} p-5 md:p-8 rounded-2xl shadow-sm animate-pulse border ${theme.border}`}>
      <div className="h-6 md:h-8 bg-gray-200/70 rounded-md w-3/4 mb-5"></div>
      <div className="h-4 bg-gray-200/70 rounded w-full mb-3"></div>
      <div className="h-4 bg-gray-200/70 rounded w-full mb-3"></div>
      <div className="h-4 bg-gray-200/70 rounded w-2/3 mb-7"></div>
      <div className={`flex gap-3 pt-5 border-t ${theme.border}`}>
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
        const [qData, rData] = await Promise.all([forumApi.getById(qid), forumApi.getReplies(qid)]);
        setQuestion(qData);
        setAnswers(rData);
      } catch (error) {
        console.error('Load question failed:', error);
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
    <div className={`min-h-screen ${theme.bg} pb-24 font-sans transition-colors duration-300`}>
      <div className={`sticky top-0 z-40 backdrop-blur-md border-b ${theme.border} ${themeMode === 'light' ? 'bg-white/92' : 'bg-[#121417]/92'}`}>
        <div className="max-w-[1000px] mx-auto px-4 h-14 md:h-16 flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className={`${theme.textSub} ${themeMode === 'light' ? 'hover:text-[#1f2329]' : 'hover:text-[#edf1f4]'} transition-colors flex items-center gap-1`}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <span className={`font-bold truncate max-w-[62vw] md:max-w-[520px] text-center text-[15px] opacity-95 ${theme.textMain}`}>
            {loading ? '加载中...' : question?.title}
          </span>

          <div className="relative" ref={settingsRef}>
            <button onClick={() => setShowSettings((prev) => !prev)} className={`${theme.icon} transition-colors p-1.5`}>
              <Settings className="w-5 h-5" />
            </button>

            {showSettings && (
              <div className={`absolute right-0 top-11 w-64 p-4 rounded-xl border shadow-xl z-50 ${theme.panel}`}>
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
      </div>

      <div className="max-w-[1000px] mx-auto mt-3 md:mt-6 px-4">
        {loading ? (
          <QuestionSkeleton themeMode={themeMode} />
        ) : !question ? (
          <div className={`${theme.card} p-10 text-center ${theme.textSub} rounded-2xl border ${theme.border}`}>问题不存在</div>
        ) : (
          <>
            <section className={`${theme.card} mb-4 md:mb-6 p-5 md:p-8 rounded-2xl shadow-sm border ${theme.border}`}>
              {question.tags?.length ? (
                <div className="flex flex-wrap gap-2 mb-4">
                  {question.tags.map((tag: string) => (
                    <span
                      key={tag}
                      className={`${themeMode === 'light' ? 'bg-[#f1f3f5] text-[#5e6673]' : 'bg-[#2a3038] text-[#b7bec8]'} px-2.5 py-1 rounded-md text-xs font-medium`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}

              <h1 className={`font-bold mb-4 md:mb-6 leading-[1.38] tracking-tight ${theme.textMain}`} style={{ fontSize: `${fontSize + 8}px` }}>
                {question.title}
              </h1>

              <div
                className={`${theme.textMain} leading-8 mb-6 md:mb-8 rich-text-content`}
                style={{ fontSize: `${fontSize}px` }}
                dangerouslySetInnerHTML={{ __html: question.content || '' }}
              />

              <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t pt-4 ${theme.border}`}>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowEditor(!showEditor)}
                    className={`px-4 md:px-6 py-2.5 rounded-lg text-sm font-medium transition-colors ${showEditor ? 'bg-[#eef0f2] text-[#606a76]' : 'bg-[#111827] text-white hover:bg-black'}`}
                  >
                    {showEditor ? '收起回答框' : '写回答'}
                  </button>
                  <button className={`px-4 md:px-5 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${theme.secondaryBtn}`}>
                    <Plus className="w-4 h-4" /> 关注问题
                  </button>
                </div>
                <div className={`text-xs font-medium ${theme.textSub}`}>
                  {formatCount(question.views || 0)} 浏览 · {formatCount(question.comments || 0)} 讨论
                </div>
              </div>

              {showEditor && (
                <div className="mt-5 animate-in fade-in slide-in-from-top-2">
                  <div className={`border rounded-xl overflow-hidden shadow-sm ${theme.border} ${theme.card}`}>
                    <textarea
                      className={`w-full h-36 md:h-40 p-4 outline-none resize-none leading-relaxed ${theme.card} ${theme.textMain}`}
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
                    <div className={`px-4 py-3 flex justify-between items-center border-t ${theme.border} ${themeMode === 'light' ? 'bg-[#f8f9fb]' : 'bg-[#242a32]'}`}>
                      <span className={`text-xs ${theme.textSub}`}>支持换行排版</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowEditor(false)}
                          className={`${theme.textSub} text-sm px-2.5 ${themeMode === 'light' ? 'hover:text-[#1f2329]' : 'hover:text-[#edf1f4]'}`}
                        >
                          取消
                        </button>
                        <button
                          onClick={handleSubmitReply}
                          disabled={isSubmitting}
                          className="bg-[#111827] text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50 flex items-center gap-1.5 hover:bg-black transition-colors"
                        >
                          {isSubmitting ? '提交中...' : <><Send className="w-3.5 h-3.5" /> 发布回答</>}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <div className="flex justify-between items-center px-1 pb-3">
              <span className={`font-bold text-base ${theme.textMain}`}>{answers.length} 个回答</span>
              <span className={`flex items-center gap-1 text-sm cursor-pointer ${theme.textSub}`}>
                默认排序 <ChevronDown className="w-4 h-4" />
              </span>
            </div>

            <div className="flex flex-col gap-3 md:gap-4">
              {answers.map((answer) => (
                <Link
                  href={`/forum/${answer.id}?fromQuestion=${question.id}`}
                  key={answer.id}
                  className={`${theme.card} p-4 md:p-6 rounded-2xl shadow-sm border border-transparent hover:border-[#dbe1e8] hover:shadow-md transition-all duration-300 block group`}
                >
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className={`w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center overflow-hidden ${themeMode === 'light' ? 'bg-[#f1f3f5] border border-[#f3f5f7]' : 'bg-[#2d333b] border border-[#353b43]'}`}>
                      {answer.author?.avatar ? (
                        <img src={answer.author.avatar} alt="avatar" className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-4 h-4 md:w-5 md:h-5 text-gray-400" />
                      )}
                    </div>
                    <span className={`text-sm font-bold ${theme.textMain}`}>{answer.author?.name || '匿名用户'}</span>
                  </div>

                  <div
                    className={`leading-7 mb-4 line-clamp-3 group-hover:text-[#1f2329] transition-colors ${theme.textSub}`}
                    style={{ fontSize: `${fontSize}px` }}
                    dangerouslySetInnerHTML={{ __html: answer.content }}
                  />

                  <div className={`flex items-center gap-4 text-sm font-medium ${theme.textSub}`}>
                    <span className="flex items-center gap-1.5">
                      <ThumbsUp className="w-4 h-4" /> {formatCount(answer.votes || 0)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MessageCircle className="w-4 h-4" /> {formatCount(answer.comments || 0)}
                    </span>
                    <span className="text-xs ml-auto">{answer.time?.split(' ')[0] || ''}</span>
                  </div>
                </Link>
              ))}

              {answers.length === 0 && <div className={`py-12 text-center ${theme.textSub}`}>暂时还没有回答，来做第一个回答者吧。</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
