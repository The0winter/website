'use client';
import ShareArrow from '@/components/ShareArrow';
import { useAuth } from '@/contexts/AuthContext';
import {useReadingSettings} from '@/contexts/ReadingSettingsContext';
import {useForumView} from '@/lib/useForumView';
import ForumSourceCredit from '@/components/ForumSourceCredit';
import ForumPostList from '@/components/ForumPostList';
import ForumAnswerReader from '@/components/ForumAnswerReader';
import {answerFeedItem, textToForumHtml} from '@/lib/forum-presentation';
import {refreshForum} from '@/lib/forum-cache';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronRight,
  MessageCircle,
  Moon,
  Settings,
  Sun,
  ThumbsUp,
  Type,
  User,
  X
} from 'lucide-react';
import { forumApi, ForumComment, ForumPost, ForumReply } from '@/lib/api';

import {FORUM_DEFAULT_FONT_SIZE,readForumFontSize,saveForumFontSize} from '@/lib/forum-reader-settings';
import ForumSlide from '@/components/ForumSlide';

const THEMES = {
  light: {
    bg: 'bg-[#f5f6f7]',
    card: 'bg-white',
    textMain: 'text-[#1f2329]',
    textSub: 'text-[#646a73]',
    border: 'border-[#e6e8eb]',
    divider: 'border-[#e3e7eb]',
    codeBg: 'bg-[#eff2f5]',
    icon: 'text-[#8a8f98] hover:text-[#1f2329]',
    panel: 'bg-white/95 border-[#e1e4e8] text-[#1f2329]'
  },
  dark: {
    bg: 'bg-[#121417]',
    card: 'bg-[#1c2026]',
    textMain: 'text-[#f4f6f8]',
    textSub: 'text-[#9ea4ad]',
    border: 'border-[#30353c]',
    divider: 'border-[#343a42]',
    codeBg: 'bg-[#2b3139]',
    icon: 'text-[#7f8791] hover:text-[#edf1f4]',
    panel: 'bg-[#1f242b]/95 border-[#343a42] text-[#f4f6f8]'
  }
};

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN');
}

function formatCount(value: number) {
  if (!value) return '0';
  if (value >= 10000) return `${(value / 10000).toFixed(1)}w`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function PostContent() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();

  const rawId = params?.postId || params?.id;
  const postId = (Array.isArray(rawId) ? rawId[0] : rawId) as string;
  const fromQuestionId = searchParams.get('fromQuestion');

  const {theme: themeMode, setTheme: setThemeMode} = useReadingSettings();
  const [fontSize, setFontSize] = useState(FORUM_DEFAULT_FONT_SIZE);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const currentTheme = THEMES[themeMode];

  const [question, setQuestion] = useState<ForumPost | null>(null);
  useForumView(question?.id);
  const [answer, setAnswer] = useState<ForumReply | null>(null);
  const [otherAnswers, setOtherAnswers] = useState<ForumReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [retry, setRetry] = useState(0);

  const [likedState, setLikedState] = useState<Record<string, boolean>>({});
  const [likePending, setLikePending] = useState<Record<string, boolean>>({});

  const [showCommentsModal, setShowCommentsModal] = useState(false);
  const [activeCommentTarget, setActiveCommentTarget] = useState<ForumReply | null>(null);
  const [replyComments, setReplyComments] = useState<ForumComment[]>([]);
  const [commentPage,setCommentPage]=useState(1);
  const [commentHasMore,setCommentHasMore]=useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [replyToComment, setReplyToComment] = useState<ForumComment | null>(null);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentLikePending, setCommentLikePending] = useState<Record<string, boolean>>({});
  const commentRequest = useRef(0);
  const autoComments = useRef('');
  const commentDialog = useRef<HTMLDivElement>(null);
  const isArticle = !fromQuestionId && question?.type === 'article';

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {setFontSize(readForumFontSize());}, []);
  const changeFont = (size:number) => {setFontSize(size);saveForumFontSize(size);};

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      if (!postId || postId === 'undefined') return;

      try {
        setLoading(true);
        setErrorMsg(''); setAnswer(null); setQuestion(null);

        let finalQuestion: ForumPost | null = null;
        let finalAnswer: ForumReply | null = null;
        let allReplies: ForumReply[] = [];

        if (fromQuestionId && fromQuestionId !== 'undefined') {
          const [qData, replies, selected] = await Promise.all([forumApi.getById(fromQuestionId), forumApi.getReplies(fromQuestionId),forumApi.getReply(fromQuestionId,postId)]);
          if (!selected || qData.type !== 'question') throw new Error('回答不存在或不属于这个问题');
          finalQuestion = qData;
          allReplies = replies;
          finalAnswer = selected;
        } else {
          const postData = await forumApi.getById(postId);
          if (postData.type === 'question') {if (active) router.replace(`/forum/question/${postData.id}`); return;}
          finalQuestion = postData;

          if (postData.id) {
            try {
              allReplies = await forumApi.getReplies(postData.id);
            } catch {
              allReplies = [];
            }
          }

          finalAnswer = {
            id: postData.id,
            content: postData.content || '',
            votes: postData.votes || 0,
            hasLiked: postData.hasLiked,
            comments: postData.comments || 0,
            time: postData.created_at || '',
            author:
              typeof postData.author === 'string'
                ? { name: postData.author, avatar: '', bio: '', id: '' }
                : {
                    name: postData.author?.name || '匿名用户',
                    avatar: postData.author?.avatar || '',
                    bio: postData.author?.bio || '',
                    id: postData.author?.id || ''
                  }
          } as ForumReply;
        }

        if (!active) return;
        if (finalQuestion) setQuestion(finalQuestion);
        if (finalAnswer) setAnswer(finalAnswer);

        if (allReplies.length > 0 && finalAnswer) {
          const others = allReplies.filter((r) => r.id !== finalAnswer?.id).sort((a, b) => (b.votes || 0) - (a.votes || 0));
          setOtherAnswers(others);
        } else {
          setOtherAnswers([]);
        }

        const initialLiked: Record<string, boolean> = {};
        if (finalQuestion?.id) initialLiked[finalQuestion.id] = Boolean(finalQuestion.hasLiked);
        if (finalAnswer?.id) initialLiked[finalAnswer.id] = Boolean(finalAnswer.hasLiked);
        allReplies.forEach((r) => {
          initialLiked[r.id] = Boolean(r.hasLiked);
        });
        setLikedState((prev) => ({ ...prev, ...initialLiked }));
      } catch (caught: unknown) { const error = caught instanceof Error ? caught : new Error('操作失败');
        if (active) setErrorMsg(error?.message || '加载失败');
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchData();
    return () => {active = false;};
  }, [postId, fromQuestionId, retry, router]);

  const requireLogin = () => {
    const loggedIn = !!user;
    if (!loggedIn) {
      alert('请先登录');
      router.push('/login');
      return false;
    }
    return true;
  };

  const handleLike = async (targetId: string, targetType: 'post' | 'reply') => {
    if (!targetId || likePending[targetId]) return;
    if (!requireLogin()) return;

    setLikePending((prev) => ({ ...prev, [targetId]: true }));
    try {
      const desired = !likedState[targetId];
      const result = targetType === 'post' ? await forumApi.togglePostLike(targetId, desired) : await forumApi.toggleReplyLike(targetId, desired);

      setLikedState((prev) => ({ ...prev, [targetId]: result.liked }));
      setAnswer((prev) => (prev && prev.id === targetId ? { ...prev, votes: result.votes } : prev));
      setOtherAnswers((prev) => prev.map((item) => (item.id === targetId ? { ...item, votes: result.votes } : item)));
      setQuestion((prev) => (prev && prev.id === targetId ? { ...prev, votes: result.votes } : prev));
      refreshForum();
    } catch (caught: unknown) { const error = caught instanceof Error ? caught : new Error('操作失败');
      if (error?.message?.includes('401') || error?.message?.includes('403')) {
        alert('登录状态已过期，请重新登录');
        router.push('/login');
      } else {
        alert('点赞失败，请稍后重试');
      }
    } finally {
      setLikePending((prev) => ({ ...prev, [targetId]: false }));
    }
  };

  const refreshComments = async (replyId: string, page=1) => {
    const request = ++commentRequest.current;
    setCommentsLoading(true);
    try {
      const data: ForumComment[] = isArticle
        ? (await forumApi.getReplies(replyId,page)).map(row => ({...row, postId:replyId, replyId:row.id, parentCommentId:null, replyCount:row.comments}))
        : await forumApi.getReplyComments(replyId,page);
      if (request !== commentRequest.current) return;
      setReplyComments(previous=>page===1?data:[...previous,...data.filter(row=>!previous.some(existing=>existing.id===row.id))]);
      setCommentPage(page);setCommentHasMore(data.length===(isArticle ? 20 : 100));
    } catch (caught: unknown) { const error = caught instanceof Error ? caught : new Error('操作失败');
      alert(error?.message || '加载评论失败');
    } finally {
      if (request === commentRequest.current) setCommentsLoading(false);
    }
  };

  const openCommentsModal = async (target: ForumReply) => {
    setReplyComments([]);
    setActiveCommentTarget(target);
    setShowCommentsModal(true);
    setReplyToComment(null);
    setCommentText('');
    await refreshComments(target.id);
  };

  const closeCommentsModal = () => {
    commentRequest.current++;
    setShowCommentsModal(false);
    setActiveCommentTarget(null);
    setReplyComments([]);
    setReplyToComment(null);
    setCommentText('');
  };

  useEffect(() => {
    if (!loading && answer && searchParams.get('comments') === '1' && autoComments.current !== answer.id) {
      autoComments.current = answer.id;
      void openCommentsModal(answer);
    }
  // The link opens the dialog once per answer; likes/comments do not reopen it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, answer?.id, searchParams]);

  useEffect(() => {
    if (!showCommentsModal) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    commentDialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {setShowCommentsModal(false); commentRequest.current++;}
      if (event.key !== 'Tab') return;
      const nodes = commentDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],textarea');
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === commentDialog.current)) {event.preventDefault();last.focus();}
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === commentDialog.current)) {event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown', onKey);
    return () => {document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKey); previousFocus?.focus();};
  }, [showCommentsModal]);

  const handleCommentSubmit = async () => {
    if (!activeCommentTarget || !commentText.trim()) return;
    if (!requireLogin() || commentSubmitting) return;

    setCommentSubmitting(true);
    try {
      const parentId = replyToComment ? (replyToComment.parentCommentId || replyToComment.id) : null;

      if (isArticle) await forumApi.createReply(activeCommentTarget.id, textToForumHtml(commentText));
      else await forumApi.createReplyComment(activeCommentTarget.id, {
        content: textToForumHtml(commentText),
        parentCommentId: parentId
      });
      refreshForum();

      setCommentText('');
      setReplyToComment(null);
      await refreshComments(activeCommentTarget.id);

      setAnswer((prev) => (prev && prev.id === activeCommentTarget.id ? { ...prev, comments: (prev.comments || 0) + 1 } : prev));
      setOtherAnswers((prev) =>
        prev.map((item) => (item.id === activeCommentTarget.id ? { ...item, comments: (item.comments || 0) + 1 } : item))
      );
      setActiveCommentTarget((prev) => (prev ? { ...prev, comments: (prev.comments || 0) + 1 } : prev));
    } catch (caught: unknown) { const error = caught instanceof Error ? caught : new Error('操作失败');
      if (error?.message?.includes('401') || error?.message?.includes('403')) {
        alert('登录状态已过期，请重新登录');
        router.push('/login');
      } else {
        alert(error?.message || '评论发送失败');
      }
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleCommentLike = async (commentId: string) => {
    if (!commentId || commentLikePending[commentId]) return;
    if (!requireLogin()) return;

    setCommentLikePending((prev) => ({ ...prev, [commentId]: true }));
    try {
      const desired = !replyComments.find(item=>item.id===commentId)?.hasLiked;
      const result = isArticle ? await forumApi.toggleReplyLike(commentId, desired) : await forumApi.toggleCommentLike(commentId, desired);
      setReplyComments((prev) =>
        prev.map((item) => (item.id === commentId ? { ...item, votes: result.votes, hasLiked: result.liked } : item))
      );
    } catch (caught: unknown) { const error = caught instanceof Error ? caught : new Error('操作失败');
      if (error?.message?.includes('401') || error?.message?.includes('403')) {
        alert('登录状态已过期，请重新登录');
        router.push('/login');
      } else {
        alert(error?.message || '点赞失败');
      }
    } finally {
      setCommentLikePending((prev) => ({ ...prev, [commentId]: false }));
    }
  };

  const commentMap = replyComments.reduce<Record<string, ForumComment>>((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});

  const topLevelComments = replyComments.filter((item) => !item.parentCommentId);
  const childCommentsMap = replyComments.reduce<Record<string, ForumComment[]>>((acc, item) => {
    if (!item.parentCommentId) return acc;
    if (!acc[item.parentCommentId]) acc[item.parentCommentId] = [];
    acc[item.parentCommentId].push(item);
    return acc;
  }, {});

  if (loading) {
    return <div className={`min-h-screen ${currentTheme.bg} pt-20 text-center ${currentTheme.textSub}`}>加载中...</div>;
  }

  if (errorMsg) {
    return <div role="alert" className={`min-h-screen ${currentTheme.bg} flex flex-col gap-4 items-center justify-center ${currentTheme.textSub}`}><p>{errorMsg}</p><button className="underline" onClick={() => setRetry(value => value + 1)}>重试</button><Link href="/forum">返回论坛</Link></div>;
  }

  if (!answer || !question) {
    return <div className={`min-h-screen ${currentTheme.bg} flex items-center justify-center ${currentTheme.textSub}`}>内容不存在</div>;
  }

  return (
    <div className={`forum-reading min-h-screen ${currentTheme.bg} pb-24 font-sans transition-colors duration-300`}>
      <div
        className={`sticky top-0 z-40 border-b backdrop-blur-md ${currentTheme.border} ${themeMode === 'light' ? 'bg-white/92' : 'bg-[#121417]/92'}`}
      >
        <div className="max-w-[860px] mx-auto px-4 h-14 md:h-16 flex items-center justify-between">
          <Link
            href="/forum"
            aria-label="返回论坛"
            className={`${currentTheme.textSub} ${themeMode === 'light' ? 'hover:text-[#1f2329]' : 'hover:text-[#edf1f4]'} transition-colors flex items-center gap-1`}
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-semibold text-sm hidden sm:inline">论坛首页</span>
          </Link>

          <div className="flex gap-1.5 relative" ref={settingsRef}>
            <button className={`p-2 ${currentTheme.icon}`} title="分享" aria-label="复制文章链接" onClick={async () => {try {await navigator.clipboard.writeText(window.location.href); setShareMessage('链接已复制');} catch {setShareMessage('请复制地址栏中的链接');}}}>
              <ShareArrow className="w-5 h-5" />
            </button>
            {shareMessage && <span role="status" className="absolute right-0 top-12 whitespace-nowrap rounded-lg bg-[var(--forum-card)] px-3 py-2 text-xs shadow">{shareMessage}</span>}

            <button
              onClick={() => setShowSettings((prev) => !prev)}
              className={`p-2 transition-colors rounded-full ${
                showSettings ? (themeMode === 'light' ? 'bg-gray-100 text-gray-900' : 'bg-[#30363e] text-gray-100') : currentTheme.icon
              }`}
              title="阅读设置"
            >
              <Settings className="w-5 h-5" />
            </button>

            {showSettings && (
              <div className={`forum-article-settings absolute right-0 top-12 w-64 p-4 rounded-xl border shadow-xl z-50 ${currentTheme.panel}`}>
                <div className="mb-4">
                  <div className="text-xs font-bold opacity-70 mb-2 px-1">主题</div>
                  <div className={`flex p-1 rounded-lg ${themeMode === 'light' ? 'bg-gray-100' : 'bg-white/10'}`}>
                    <button
                      onClick={() => setThemeMode('light')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium ${
                        themeMode === 'light' ? 'bg-white text-black shadow-sm' : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      <Sun className="w-4 h-4" /> 浅色
                    </button>
                    <button
                      onClick={() => setThemeMode('dark')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium ${
                        themeMode === 'dark' ? 'bg-[#333] text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
                      }`}
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
                    <button onClick={() => changeFont(Math.max(14,fontSize - 1))} className="p-1 hover:bg-black/10 rounded">
                      <Type className="w-3 h-3" />
                    </button>
                    <div className="flex gap-1">
                      {[14, 16, 18, 20, 22].map((size) => (
                        <button
                          key={size}
                          onClick={() => changeFont(size)}
                          className={`h-2 w-2 rounded-full ${
                            fontSize >= size ? (themeMode === 'light' ? 'bg-black' : 'bg-white') : 'bg-gray-300 opacity-40'
                          }`}
                          aria-label={`字号 ${size}`}
                        />
                      ))}
                    </div>
                    <button onClick={() => changeFont(Math.min(24,fontSize + 1))} className="p-1 hover:bg-black/10 rounded">
                      <Type className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ForumSlide className="forum-reading-shell max-w-[860px] mx-auto mt-3 md:mt-6 px-4">
        <div className="forum-question-heading mb-4">
          {question.bookId && <Link className="inline-block text-xs text-[var(--forum-muted)] mb-3" href={`/book/${question.bookId}`}>《{question.bookTitle || '相关书籍'}》 · 书籍讨论</Link>}
          <Link href={isArticle ? `/forum/${question.id}` : `/forum/question/${question.id}`}>
            <h1
              className={`text-[26px] md:text-[34px] font-bold ${currentTheme.textMain} leading-[1.33] mb-3 tracking-tight hover:text-blue-600 transition-colors cursor-pointer group`}
            >
              {question.title}
              {!isArticle && <ChevronRight className="inline-block w-5 h-5 md:w-6 md:h-6 ml-1 text-gray-400 group-hover:text-blue-600 transition-colors mb-1" />}
            </h1>
          </Link>
          {question.tags?.length ? (
            <div className="flex flex-wrap gap-2">
              {question.tags.map((tag: string) => (
                <span
                  key={tag}
                  className={`${currentTheme.card} border ${currentTheme.border} ${currentTheme.textSub} px-2 py-0.5 rounded text-xs font-medium`}
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <article className={`forum-answer-card ${currentTheme.card} p-5 md:p-9 shadow-sm rounded-2xl border ${currentTheme.border} mb-8 transition-colors duration-300`}>
          {answer.title && <h2 className="text-[23px] md:text-[28px] font-semibold leading-relaxed mb-6 tracking-tight">{answer.title}</h2>}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 md:w-12 md:h-12 rounded-full ${currentTheme.codeBg} flex items-center justify-center overflow-hidden`}>
                {answer.author?.avatar ? (
                  <img src={answer.author.avatar} className="w-full h-full object-cover" alt="avatar" />
                ) : (
                  <User className={`w-5 h-5 md:w-6 md:h-6 ${currentTheme.textSub}`} />
                )}
              </div>
              <div>
                <div className={`font-bold ${currentTheme.textMain} text-sm md:text-base`}>{answer.author?.name || '匿名用户'}</div>
                <div className={`text-xs ${currentTheme.textSub} mt-0.5`}>{answer.source ? '书评原作者 · ' + formatDate(answer.source.publishedAt || '') : formatDate(answer.time)}</div>
              </div>
            </div>
            <button aria-label="打开评论" onClick={() => openCommentsModal(answer)} className="text-xs text-[var(--forum-muted)] flex items-center gap-1.5 py-2"><MessageCircle size={15}/>{answer.comments || 0} 条评论</button>
          </div>

          <div
            style={{ fontSize: `${fontSize}px` }}
            className={`rich-text-content forum-prose ${currentTheme.textMain} font-normal transition-colors`}
            dangerouslySetInnerHTML={{ __html: answer.content }}
          />
          <ForumSourceCredit source={answer.source}/>

          <div className="mt-6 flex items-center justify-between">
            <div className={`text-xs md:text-sm ${currentTheme.textSub}`}>{answer.source ? '收录于 ' : '发布于 '}{formatDate(answer.time)}</div>
            <div className="flex gap-5 md:gap-6">
              <button
                aria-label={likedState[answer.id] ? '取消点赞回答' : '点赞回答'}
                onClick={() => handleLike(answer.id, answer.id === question.id ? 'post' : 'reply')}
                disabled={!!likePending[answer.id]}
                className={`flex items-center gap-1.5 transition-colors ${
                  likedState[answer.id] ? 'text-blue-500' : currentTheme.icon
                } disabled:opacity-60`}
              >
                <ThumbsUp className="w-5 h-5" />
                <span className="font-semibold text-sm">{formatCount(answer.votes || 0)}</span>
              </button>
              <button
                aria-label="查看文章评论"
                onClick={() => openCommentsModal(answer)}
                className={`flex items-center gap-1.5 ${currentTheme.icon} transition-colors`}
              >
                <MessageCircle className="w-5 h-5" />
                <span className="font-semibold text-sm">{formatCount(answer.comments || 0)}</span>
              </button>
            </div>
          </div>
        </article>

        {fromQuestionId && <section className="forum-more-answers">
          <div className="flex items-center justify-between gap-3 mb-4 text-sm">
            <h2 className="font-semibold">这个问题的其他回答</h2>
            <Link className="text-blue-600" href={`/forum/question/${question.id}`}>查看全部 {question.comments} 个回答 →</Link>
          </div>
          <ForumPostList posts={otherAnswers.slice(0, 3).map(item => answerFeedItem(question, item))} loading={false} hideQuestion/>
        </section>}

        {showCommentsModal && activeCommentTarget && (
          <div
            className="forum-article-comments fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
            onClick={closeCommentsModal}
          >
            <div
              ref={commentDialog} role="dialog" aria-modal="true" aria-label="文章评论" tabIndex={-1}
              className={`w-full md:max-w-2xl h-[88vh] md:h-[80vh] ${currentTheme.card} border ${currentTheme.border} rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={`px-4 md:px-5 py-3.5 border-b ${currentTheme.divider} flex items-center justify-between`}>
                <div>
                  <div className={`text-xs ${currentTheme.textSub}`}>评论区</div>
                  <div className={`font-bold ${currentTheme.textMain} text-sm md:text-base`}>
                    {(activeCommentTarget.author?.name || '匿名用户')} · {activeCommentTarget.comments || 0} 条评论
                  </div>
                </div>
                <button aria-label="关闭评论" onClick={closeCommentsModal} className={`${currentTheme.icon}`}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 md:px-5 py-4 space-y-4">
                {commentHasMore&&<button disabled={commentsLoading} onClick={()=>refreshComments(activeCommentTarget.id,commentPage+1)}>加载更多评论</button>}
                {commentsLoading && <div className={`text-center text-sm ${currentTheme.textSub} py-8`}>评论加载中...</div>}

                {!commentsLoading && topLevelComments.length === 0 && (
                  <div className={`text-center text-sm ${currentTheme.textSub} py-8`}>还没有评论，来抢沙发吧。</div>
                )}

                {!commentsLoading &&
                  topLevelComments.map((comment) => (
                    <div key={comment.id} className={`border ${currentTheme.border} rounded-xl p-3.5 md:p-4`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className={`font-semibold text-sm ${currentTheme.textMain}`}>{comment.author?.name || '匿名用户'}</div>
                        <div className={`text-xs ${currentTheme.textSub}`}>{formatDate(comment.time)}</div>
                      </div>

                      <div className={`${currentTheme.textMain} text-sm leading-7`} dangerouslySetInnerHTML={{ __html: comment.content }} />

                      <div className={`mt-3 flex items-center gap-5 text-xs ${currentTheme.textSub}`}>
                        <button
                          onClick={() => handleCommentLike(comment.id)}
                          disabled={!!commentLikePending[comment.id]}
                          className={`flex items-center gap-1 ${comment.hasLiked ? 'text-blue-500' : ''} disabled:opacity-60`}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                          {formatCount(comment.votes || 0)}
                        </button>
                        {!isArticle && <button onClick={() => setReplyToComment(comment)} className="flex items-center gap-1">
                          <MessageCircle className="w-3.5 h-3.5" />
                          回复
                        </button>}
                      </div>

                      {(childCommentsMap[comment.id] || []).length > 0 && (
                        <div className={`mt-3 pl-3 border-l ${currentTheme.divider} space-y-3`}>
                          {(childCommentsMap[comment.id] || []).map((child) => (
                            <div key={child.id} className="text-sm">
                              <div className="flex items-center justify-between">
                                <span className={`font-medium ${currentTheme.textMain}`}>{child.author?.name || '匿名用户'}</span>
                                <span className={`text-xs ${currentTheme.textSub}`}>{formatDate(child.time)}</span>
                              </div>
                              <div className={`${currentTheme.textMain} leading-6 mt-1`} dangerouslySetInnerHTML={{ __html: child.content }} />
                              <div className={`mt-2 flex items-center gap-5 text-xs ${currentTheme.textSub}`}>
                                <button
                                  onClick={() => handleCommentLike(child.id)}
                                  disabled={!!commentLikePending[child.id]}
                                  className={`flex items-center gap-1 ${child.hasLiked ? 'text-blue-500' : ''} disabled:opacity-60`}
                                >
                                  <ThumbsUp className="w-3.5 h-3.5" />
                                  {formatCount(child.votes || 0)}
                                </button>
                                <button
                                  onClick={() => {
                                    const root = child.parentCommentId ? commentMap[child.parentCommentId] : child;
                                    setReplyToComment(root || child);
                                  }}
                                  className="flex items-center gap-1"
                                >
                                  <MessageCircle className="w-3.5 h-3.5" />
                                  回复
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
              </div>

              <div className={`border-t ${currentTheme.divider} p-4`}>
                {replyToComment && (
                  <div className={`mb-2 text-xs ${currentTheme.textSub} flex items-center justify-between`}>
                    <span>回复给：{replyToComment.author?.name}</span>
                    <button onClick={() => setReplyToComment(null)} className={currentTheme.icon}>
                      取消
                    </button>
                  </div>
                )}
                <textarea
                  aria-label="评论内容" maxLength={2000}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={replyToComment ? `回复 ${replyToComment.author?.name}...` : '写下你的评论...'}
                  className={`w-full h-20 md:h-24 resize-none rounded-lg border ${currentTheme.border} ${currentTheme.card} ${currentTheme.textMain} p-3 outline-none`}
                />
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={handleCommentSubmit}
                    disabled={commentSubmitting || !commentText.trim()}
                    className="px-4 py-2 rounded-lg bg-[#111827] text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {commentSubmitting ? '发送中...' : '发布评论'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="h-8"></div>
      </ForumSlide>
    </div>
  );
}

export default function PostDetailPage() {

  return (
    <Suspense fallback={<div>加载中...</div>}>
      <PostRoute />
    </Suspense>
  );
}

function PostRoute() {
  const params = useParams();
  const search = useSearchParams();
  const questionId = search.get('fromQuestion');
  const id = params?.postId;
  if (questionId && typeof id === 'string') return <ForumAnswerReader key={`${questionId}:${id}`} questionId={questionId} initialAnswerId={id} openComments={search.get('comments') === '1'}/>;
  return <PostContent/>;
}
