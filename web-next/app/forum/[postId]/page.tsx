'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronRight,
  MessageCircle,
  Moon,
  Settings,
  Share2,
  Sun,
  ThumbsUp,
  Type,
  User,
  X
} from 'lucide-react';
import { forumApi, ForumComment, ForumPost, ForumReply } from '@/lib/api';

type ThemeMode = 'light' | 'dark';

const READER_SETTINGS_KEY = 'forum_reader_settings_v1';

const THEMES = {
  light: {
    bg: 'bg-[#f8f9fa]',
    card: 'bg-white',
    textMain: 'text-gray-900',
    textSub: 'text-gray-500',
    border: 'border-gray-100',
    divider: 'border-gray-200',
    codeBg: 'bg-gray-100',
    icon: 'text-gray-400 hover:text-gray-900',
    panel: 'bg-white/95 border-gray-200 text-gray-900',
  },
  dark: {
    bg: 'bg-[#121212]',
    card: 'bg-[#1e1e1e]',
    textMain: 'text-gray-200',
    textSub: 'text-gray-400',
    border: 'border-[#2d2d2d]',
    divider: 'border-[#333]',
    codeBg: 'bg-[#2d2d2d]',
    icon: 'text-gray-500 hover:text-gray-200',
    panel: 'bg-[#1e1e1e]/95 border-[#333] text-gray-200',
  }
};

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
}

function PostContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();

  const rawId = params?.postId || params?.id;
  const postId = (Array.isArray(rawId) ? rawId[0] : rawId) as string;
  const fromQuestionId = searchParams.get('fromQuestion');

  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const [fontSize, setFontSize] = useState(17);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const currentTheme = THEMES[themeMode];

  const [question, setQuestion] = useState<ForumPost | null>(null);
  const [answer, setAnswer] = useState<ForumReply | null>(null);
  const [otherAnswers, setOtherAnswers] = useState<ForumReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [likedState, setLikedState] = useState<Record<string, boolean>>({});
  const [likePending, setLikePending] = useState<Record<string, boolean>>({});

  const [showCommentsModal, setShowCommentsModal] = useState(false);
  const [activeCommentTarget, setActiveCommentTarget] = useState<ForumReply | null>(null);
  const [replyComments, setReplyComments] = useState<ForumComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [replyToComment, setReplyToComment] = useState<ForumComment | null>(null);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentLikePending, setCommentLikePending] = useState<Record<string, boolean>>({});

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
    const fetchData = async () => {
      if (!postId || postId === 'undefined') return;

      try {
        setLoading(true);

        let finalQuestion: ForumPost | null = null;
        let finalAnswer: ForumReply | null = null;
        let allReplies: ForumReply[] = [];

        if (fromQuestionId && fromQuestionId !== 'undefined') {
          const [qData, replies] = await Promise.all([
            forumApi.getById(fromQuestionId),
            forumApi.getReplies(fromQuestionId)
          ]);
          finalQuestion = qData;
          allReplies = replies;
          finalAnswer = replies.find((r) => r.id === postId) || null;
        } else {
          const postData = await forumApi.getById(postId);
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
            author: typeof postData.author === 'string'
              ? { name: postData.author, avatar: '', bio: '', id: '' }
              : {
                  name: postData.author?.name || '匿名用户',
                  avatar: postData.author?.avatar || '',
                  bio: postData.author?.bio || '',
                  id: postData.author?.id || ''
                }
          } as ForumReply;
        }

        if (finalQuestion) setQuestion(finalQuestion);
        if (finalAnswer) setAnswer(finalAnswer);

        if (allReplies.length > 0 && finalAnswer) {
          const others = allReplies
            .filter((r) => r.id !== finalAnswer?.id)
            .sort((a, b) => (b.votes || 0) - (a.votes || 0));
          setOtherAnswers(others);
        } else {
          setOtherAnswers([]);
        }

        const initialLiked: Record<string, boolean> = {};
        if (finalQuestion?.id) initialLiked[finalQuestion.id] = Boolean(finalQuestion.hasLiked);
        if (finalAnswer?.id) initialLiked[finalAnswer.id] = Boolean((finalAnswer as any).hasLiked);
        allReplies.forEach((r) => {
          initialLiked[r.id] = Boolean((r as any).hasLiked);
        });
        setLikedState((prev) => ({ ...prev, ...initialLiked }));
      } catch (error: any) {
        setErrorMsg(error?.message || '加载失败');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [postId, fromQuestionId]);

  const requireLogin = () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
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
      const result = targetType === 'post'
        ? await forumApi.togglePostLike(targetId)
        : await forumApi.toggleReplyLike(targetId);

      setLikedState((prev) => ({ ...prev, [targetId]: result.liked }));
      setAnswer((prev) => (prev && prev.id === targetId ? { ...prev, votes: result.votes } : prev));
      setOtherAnswers((prev) => prev.map((item) => (item.id === targetId ? { ...item, votes: result.votes } : item)));
      setQuestion((prev) => (prev && prev.id === targetId ? { ...prev, votes: result.votes } : prev));
    } catch (error: any) {
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

  const refreshComments = async (replyId: string) => {
    setCommentsLoading(true);
    try {
      const data = await forumApi.getReplyComments(replyId);
      setReplyComments(data);
    } catch (error: any) {
      alert(error?.message || '加载评论失败');
    } finally {
      setCommentsLoading(false);
    }
  };

  const openCommentsModal = async (target: ForumReply) => {
    if (target.id === question?.id && !fromQuestionId) {
      alert('帖子暂不支持评论');
      return;
    }
    setActiveCommentTarget(target);
    setShowCommentsModal(true);
    setReplyToComment(null);
    setCommentText('');
    await refreshComments(target.id);
  };

  const closeCommentsModal = () => {
    setShowCommentsModal(false);
    setActiveCommentTarget(null);
    setReplyComments([]);
    setReplyToComment(null);
    setCommentText('');
  };

  const handleCommentSubmit = async () => {
    if (!activeCommentTarget || !commentText.trim()) return;
    if (!requireLogin() || commentSubmitting) return;

    setCommentSubmitting(true);
    try {
      const parentId = replyToComment
        ? (replyToComment.parentCommentId || replyToComment.id)
        : null;

      await forumApi.createReplyComment(activeCommentTarget.id, {
        content: commentText.replace(/\n/g, '<br/>'),
        parentCommentId: parentId
      });

      setCommentText('');
      setReplyToComment(null);
      await refreshComments(activeCommentTarget.id);

      setAnswer((prev) => (prev && prev.id === activeCommentTarget.id ? { ...prev, comments: (prev.comments || 0) + 1 } : prev));
      setOtherAnswers((prev) => prev.map((item) => (
        item.id === activeCommentTarget.id ? { ...item, comments: (item.comments || 0) + 1 } : item
      )));
      setActiveCommentTarget((prev) => (prev ? { ...prev, comments: (prev.comments || 0) + 1 } : prev));
    } catch (error: any) {
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
      const result = await forumApi.toggleCommentLike(commentId);
      setReplyComments((prev) => prev.map((item) => (
        item.id === commentId ? { ...item, votes: result.votes, hasLiked: result.liked } : item
      )));
    } catch (error: any) {
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
    return <div className={`min-h-screen ${currentTheme.bg} flex items-center justify-center text-red-500`}>错误：{errorMsg}</div>;
  }

  if (!answer || !question) {
    return <div className={`min-h-screen ${currentTheme.bg} flex items-center justify-center ${currentTheme.textSub}`}>内容不存在</div>;
  }

  return (
    <div className={`min-h-screen ${currentTheme.bg} pb-20 font-sans transition-colors duration-300`}>
      <div className={`sticky top-0 z-40 border-b backdrop-blur-md ${currentTheme.border} ${themeMode === 'light' ? 'bg-white/90' : 'bg-[#121212]/90'}`}>
        <div className="max-w-[800px] mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/forum" className={`${currentTheme.textSub} ${themeMode === 'light' ? 'hover:text-gray-900' : 'hover:text-gray-100'} transition-colors flex items-center gap-1`}>
            <ArrowLeft className="w-5 h-5" />
            <span className="font-bold text-sm">论坛首页</span>
          </Link>

          <div className="flex gap-2 relative" ref={settingsRef}>
            <button className={`p-2 ${currentTheme.icon}`} title="分享">
              <Share2 className="w-5 h-5" />
            </button>

            <button
              onClick={() => setShowSettings((prev) => !prev)}
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
                    <button onClick={() => setFontSize((prev) => Math.max(14, prev - 1))} className="p-1 hover:bg-black/10 rounded">
                      <Type className="w-3 h-3" />
                    </button>
                    <div className="flex gap-1">
                      {[14, 16, 18, 20, 22].map((size) => (
                        <div
                          key={size}
                          onClick={() => setFontSize(size)}
                          className={`h-2 w-2 rounded-full cursor-pointer ${fontSize >= size ? (themeMode === 'light' ? 'bg-black' : 'bg-white') : 'bg-gray-300 opacity-40'}`}
                        ></div>
                      ))}
                    </div>
                    <button onClick={() => setFontSize((prev) => Math.min(24, prev + 1))} className="p-1 hover:bg-black/10 rounded">
                      <Type className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[800px] mx-auto mt-6 px-4 md:px-0">
        <div className="mb-6">
          <Link href={`/forum/question/${question.id}`}>
            <h1 className={`text-3xl font-bold ${currentTheme.textMain} leading-tight mb-3 tracking-tight hover:text-blue-600 transition-colors cursor-pointer group`}>
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

        <article className={`${currentTheme.card} p-6 md:p-7 shadow-sm rounded-xl border ${currentTheme.border} mb-10 transition-colors duration-300`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-full ${currentTheme.codeBg} flex items-center justify-center overflow-hidden`}>
                {answer.author?.avatar ? (
                  <img src={answer.author.avatar} className="w-full h-full object-cover" alt="头像" />
                ) : (
                  <User className={`w-6 h-6 ${currentTheme.textSub}`} />
                )}
              </div>
              <div>
                <div className={`font-bold ${currentTheme.textMain} text-base`}>{answer.author?.name || '匿名用户'}</div>
                <div className={`text-xs ${currentTheme.textSub} mt-0.5`}>{answer.author?.bio || '暂无个人介绍'}</div>
              </div>
            </div>
            <button className={`${themeMode === 'light' ? 'bg-gray-100 text-gray-900 hover:bg-gray-200' : 'bg-[#333] text-gray-200 hover:bg-[#444]'} px-5 py-1.5 rounded-full text-sm font-bold transition-colors`}>
              关注
            </button>
          </div>

          <div
            style={{ fontSize: `${fontSize}px` }}
            className={`rich-text-content ${currentTheme.textMain} leading-[1.8] font-normal tracking-wide space-y-5 transition-all duration-200`}
            dangerouslySetInnerHTML={{ __html: answer.content }}
          ></div>

          <div className="mt-6 flex items-center justify-between">
            <div className={`text-sm ${currentTheme.textSub}`}>
              发布于 {formatDate(answer.time)}
            </div>
            <div className="flex gap-6">
              <button
                onClick={() => handleLike(answer.id, answer.id === question.id ? 'post' : 'reply')}
                disabled={!!likePending[answer.id]}
                className={`flex items-center gap-2 transition-colors ${likedState[answer.id] ? 'text-blue-500' : currentTheme.icon} disabled:opacity-60`}
              >
                <ThumbsUp className="w-5 h-5" />
                <span className="font-bold">{answer.votes || 0}</span>
              </button>
              <button onClick={() => openCommentsModal(answer)} className={`flex items-center gap-2 ${currentTheme.icon} transition-colors`}>
                <MessageCircle className="w-5 h-5" />
                <span className="font-bold">{answer.comments || 0}</span>
              </button>
            </div>
          </div>
        </article>

        {otherAnswers.length > 0 && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="mb-4">
              <span className={`text-sm font-bold ${currentTheme.textSub}`}>更多回答（{otherAnswers.length}）</span>
            </div>

            <div className="flex flex-col gap-8">
              {otherAnswers.map((item) => (
                <article key={item.id} className={`${currentTheme.card} p-7 md:p-8 shadow-sm rounded-xl border ${currentTheme.border} transition-colors duration-300`}>
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full ${currentTheme.codeBg} flex items-center justify-center overflow-hidden`}>
                        {item.author?.avatar ? (
                          <img src={item.author.avatar} alt="头像" className="w-full h-full object-cover" />
                        ) : (
                          <span className={`${currentTheme.textSub} font-bold text-sm`}>{item.author?.name?.[0] || '匿'}</span>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className={`text-sm font-bold ${currentTheme.textMain}`}>{item.author?.name || '匿名用户'}</span>
                        <span className={`text-xs ${currentTheme.textSub}`}>{item.time.split(' ')[0]}</span>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{ fontSize: `${fontSize}px` }}
                    className={`rich-text-content ${currentTheme.textMain} leading-[1.8] font-normal tracking-wide space-y-4 transition-all duration-200`}
                    dangerouslySetInnerHTML={{ __html: item.content }}
                  ></div>

                  <div className={`mt-6 flex items-center gap-6 ${currentTheme.textSub}`}>
                    <button
                      onClick={() => handleLike(item.id, 'reply')}
                      disabled={!!likePending[item.id]}
                      className={`flex items-center gap-2 transition-colors ${likedState[item.id] ? 'text-blue-500' : currentTheme.icon} disabled:opacity-60`}
                    >
                      <ThumbsUp className="w-4 h-4" />
                      <span className="text-sm font-bold">{item.votes}</span>
                    </button>
                    <button onClick={() => openCommentsModal(item)} className={`flex items-center gap-2 transition-colors ${currentTheme.icon}`}>
                      <MessageCircle className="w-4 h-4" />
                      <span className="text-sm font-bold">{item.comments}</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {showCommentsModal && activeCommentTarget && (
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
            onClick={closeCommentsModal}
          >
            <div
              className={`w-full md:max-w-2xl h-[85vh] md:h-[80vh] ${currentTheme.card} border ${currentTheme.border} md:rounded-2xl shadow-2xl flex flex-col`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={`px-5 py-4 border-b ${currentTheme.divider} flex items-center justify-between`}>
                <div>
                  <div className={`text-sm ${currentTheme.textSub}`}>评论区</div>
                  <div className={`font-bold ${currentTheme.textMain}`}>
                    {(activeCommentTarget.author?.name || '匿名用户')} · {(activeCommentTarget.comments || 0)} 条评论
                  </div>
                </div>
                <button onClick={closeCommentsModal} className={`${currentTheme.icon}`}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {commentsLoading && (
                  <div className={`text-center text-sm ${currentTheme.textSub} py-8`}>评论加载中...</div>
                )}

                {!commentsLoading && topLevelComments.length === 0 && (
                  <div className={`text-center text-sm ${currentTheme.textSub} py-8`}>还没有评论，来抢沙发吧。</div>
                )}

                {!commentsLoading && topLevelComments.map((comment) => (
                  <div key={comment.id} className={`border ${currentTheme.border} rounded-xl p-4`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className={`font-semibold text-sm ${currentTheme.textMain}`}>{comment.author?.name || '匿名用户'}</div>
                      <div className={`text-xs ${currentTheme.textSub}`}>{comment.time}</div>
                    </div>

                    <div className={`${currentTheme.textMain} text-sm leading-7`} dangerouslySetInnerHTML={{ __html: comment.content }} />

                    <div className={`mt-3 flex items-center gap-5 text-xs ${currentTheme.textSub}`}>
                      <button
                        onClick={() => handleCommentLike(comment.id)}
                        disabled={!!commentLikePending[comment.id]}
                        className={`flex items-center gap-1 ${comment.hasLiked ? 'text-blue-500' : ''} disabled:opacity-60`}
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                        {comment.votes || 0}
                      </button>
                      <button onClick={() => setReplyToComment(comment)} className="flex items-center gap-1">
                        <MessageCircle className="w-3.5 h-3.5" />
                        回复
                      </button>
                    </div>

                    {(childCommentsMap[comment.id] || []).length > 0 && (
                      <div className={`mt-3 pl-3 border-l ${currentTheme.divider} space-y-3`}>
                        {(childCommentsMap[comment.id] || []).map((child) => (
                          <div key={child.id} className="text-sm">
                            <div className="flex items-center justify-between">
                              <span className={`font-medium ${currentTheme.textMain}`}>{child.author?.name || '匿名用户'}</span>
                              <span className={`text-xs ${currentTheme.textSub}`}>{child.time}</span>
                            </div>
                            <div className={`${currentTheme.textMain} leading-6 mt-1`} dangerouslySetInnerHTML={{ __html: child.content }} />
                            <div className={`mt-2 flex items-center gap-5 text-xs ${currentTheme.textSub}`}>
                              <button
                                onClick={() => handleCommentLike(child.id)}
                                disabled={!!commentLikePending[child.id]}
                                className={`flex items-center gap-1 ${child.hasLiked ? 'text-blue-500' : ''} disabled:opacity-60`}
                              >
                                <ThumbsUp className="w-3.5 h-3.5" />
                                {child.votes || 0}
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
                    <button onClick={() => setReplyToComment(null)} className={currentTheme.icon}>取消</button>
                  </div>
                )}
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={replyToComment ? `回复 ${replyToComment.author?.name}...` : '写下你的评论...'}
                  className={`w-full h-24 resize-none rounded-lg border ${currentTheme.border} ${currentTheme.card} ${currentTheme.textMain} p-3 outline-none`}
                />
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={handleCommentSubmit}
                    disabled={commentSubmitting || !commentText.trim()}
                    className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {commentSubmitting ? '发送中...' : '发布评论'}
                  </button>
                </div>
              </div>
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
    <Suspense fallback={<div>加载中...</div>}>
      <PostContent />
    </Suspense>
  );
}
