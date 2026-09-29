'use client';
import {useReadingSettings} from '@/contexts/ReadingSettingsContext';
import {useForumView} from '@/lib/useForumView';
import {useAuth} from '@/contexts/AuthContext';
import ForumPostList from '@/components/ForumPostList';
import {answerFeedItem, textToForumHtml} from '@/lib/forum-presentation';
import {refreshForum} from '@/lib/forum-cache';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Moon,
  Send,
  Settings,
  Sun,
  Type,
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
  const {user} = useAuth();
  const router = useRouter();
  const params = useParams();
  const qid = params?.qid as string;

  const [question, setQuestion] = useState<ForumPost | null>(null);
  useForumView(question?.id);
  const [answers, setAnswers] = useState<ForumReply[]>([]);
  const [answerPage,setAnswerPage]=useState(1);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [retry, setRetry] = useState(0);
  const [showEditor, setShowEditor] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {theme: themeMode, setTheme: setThemeMode} = useReadingSettings();
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
      if (typeof parsed?.fontSize === 'number' && parsed.fontSize >= 14 && parsed.fontSize <= 24) {
        setFontSize(parsed.fontSize);
      }
    } catch {
      // ignore broken settings
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify({ fontSize }));
    } catch {
      // ignore write failure
    }
  }, [fontSize]);

  useEffect(() => {
    if (!qid) return;
    let active = true;
    const fetchData = async () => {
      try {
        setLoading(true);
        setErrorMsg('');
        const [qData, rData] = await Promise.all([forumApi.getById(qid), forumApi.getReplies(qid,answerPage)]);
        if (!active) return;
        if (qData.type === 'article') { router.replace(`/forum/${qData.id}`); return; }
        setQuestion(qData);
        setAnswers(rData);
      } catch (error) {
        if (active) setErrorMsg(error instanceof Error ? error.message : '加载失败，请重试');
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchData();
    return () => { active = false; };
  }, [qid,answerPage,retry,router]);

  const handleSubmitReply = async () => {
    if (isSubmitting) return;
    if (!user) {router.push('/login'); return;}
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
      await forumApi.addReply(qid, { content: textToForumHtml(replyContent) });
      refreshForum();
      setReplyContent('');
      setShowEditor(false);
      setAnswerPage(1);
      const [newAnswers, updatedQuestion] = await Promise.all([forumApi.getReplies(qid), forumApi.getById(qid)]);
      setAnswers(newAnswers);
      setQuestion(updatedQuestion);
    } catch (caught: unknown) { const error = caught instanceof Error ? caught : new Error('操作失败');
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
    <div className={`forum-reading min-h-screen ${theme.bg} pb-24 font-sans transition-colors duration-300`}>
      <div className={`sticky top-0 z-40 backdrop-blur-md border-b ${theme.border} ${themeMode === 'light' ? 'bg-white/92' : 'bg-[#121417]/92'}`}>
        <div className="max-w-[1000px] mx-auto px-4 h-14 md:h-16 flex items-center justify-between">
          <Link href="/forum" aria-label="返回论坛"
            className={`${theme.textSub} ${themeMode === 'light' ? 'hover:text-[#1f2329]' : 'hover:text-[#edf1f4]'} transition-colors flex items-center gap-1`}
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>

          <span className={`font-bold truncate max-w-[62vw] md:max-w-[520px] text-center text-[15px] opacity-95 ${theme.textMain}`}>
            {loading ? '加载中...' : question?.title}
          </span>

          <div className="relative" ref={settingsRef}>
            <button aria-label="阅读设置" onClick={() => setShowSettings((prev) => !prev)} className={`${theme.icon} transition-colors p-1.5`}>
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

      <div className="forum-reading-shell max-w-[860px] mx-auto mt-3 md:mt-6 px-4">
        {loading ? (
          <QuestionSkeleton themeMode={themeMode} />
        ) : errorMsg || !question ? (
          <div role="alert" className={`${theme.card} p-10 text-center ${theme.textSub} rounded-2xl border ${theme.border}`}>{errorMsg || '问题不存在'} <button className="underline" onClick={() => setRetry(value => value + 1)}>重试</button></div>
        ) : (
          <>
            <section className={`forum-answer-card ${theme.card} mb-4 md:mb-6 p-5 md:p-8 rounded-2xl shadow-sm border ${theme.border}`}>
              {question.bookId && <Link className="inline-block text-sm text-blue-600 mb-4" href={`/book/${question.bookId}`}>《{question.bookTitle || '相关书籍'}》 · 书籍讨论</Link>}
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
                    onClick={() => {if (!user) router.push('/login'); else setShowEditor(!showEditor);}}
                    className={`px-4 md:px-6 py-2.5 rounded-lg text-sm font-medium transition-colors ${showEditor ? 'bg-[#eef0f2] text-[#606a76]' : 'bg-[#111827] text-white hover:bg-black'}`}
                  >
                    {showEditor ? '收起回答框' : '写回答'}
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
                      aria-label="回答内容" maxLength={12000}
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

            <div className="flex justify-between items-center px-5 md:px-1 pb-3">
              <span className={`font-bold text-base ${theme.textMain}`}>{question?.comments||0} 个回答</span>
              <span className={`text-xs ${theme.textSub}`}>赞同优先</span>
            </div>

            <ForumPostList posts={answers.map(answer => answerFeedItem(question, answer))} loading={false} hideQuestion/>
            {(question.comments > 20 || answerPage > 1) && <nav aria-label="回答分页" className="forum-pagination"><button disabled={answerPage === 1} onClick={() => setAnswerPage(p => p - 1)}>上一页</button><span>第 {answerPage} 页</span><button disabled={answerPage * 20 >= question.comments} onClick={() => setAnswerPage(p => p + 1)}>下一页</button></nav>}
          </>
        )}
      </div>
    </div>
  );
}
