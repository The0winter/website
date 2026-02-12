// postpage.tsx 修改后的完整逻辑

'use client';

import { Suspense, useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, MoreHorizontal, MessageCircle, Share2, ChevronDown, ThumbsUp, ThumbsDown, User, Loader2
} from 'lucide-react';
import { forumApi, ForumPost, ForumReply } from '@/lib/api';

function PostContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams(); 
  
  const rawId = params?.postId || params?.id;
  const postId = (Array.isArray(rawId) ? rawId[0] : rawId) as string;
  const fromQuestionId = searchParams.get('fromQuestion');

  // 🔥 核心修改 1: 初始化 State 时直接读取缓存
  const loadFromCache = () => {
    if (typeof window === 'undefined' || !postId) return null;
    try {
      const cacheKey = `nav_cache_${postId}`;
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      console.error('缓存读取失败', e);
    }
    return null;
  };

  const initialData = loadFromCache();

  // 如果缓存里有数据，就用缓存的，否则为 null
  const [question, setQuestion] = useState<ForumPost | null>(initialData?.question || null);
  const [answer, setAnswer] = useState<ForumReply | null>(initialData?.answer || null);
  
  // 🔥 核心修改 2: 如果有初始数据，loading 直接为 false，实现“秒开”
  const [loading, setLoading] = useState(!initialData?.answer);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    // 即使有缓存，我们也请求一次API，确保数据是最新的（比如点赞数更新了）
    // 这叫 "Stale-While-Revalidate" 策略
    
    const fetchData = async () => {
      if (!postId || postId === 'undefined' || postId === 'null') return;

      try {
        // 如果没有缓存数据，才需要显示 loading 状态
        // 如果有缓存，我们就在后台静默更新，不转圈圈
        if (!question || !answer) {
             setLoading(true);
        }
        
        // ... 原有的请求逻辑 ...
        let finalQuestion = null;
        let finalAnswer = null;

        if (fromQuestionId && fromQuestionId !== 'undefined') {
            const [qData, replies] = await Promise.all([
                forumApi.getById(fromQuestionId),
                forumApi.getReplies(fromQuestionId)
            ]);
            finalQuestion = qData;
            finalAnswer = replies.find(r => r.id === postId) || null;
        } else {
            const postData = await forumApi.getById(postId);
            finalAnswer = {
                id: postData.id,
                content: postData.content || '',
                votes: postData.votes,
                comments: postData.comments,
                time: postData.created_at || '',
                author: typeof postData.author === 'string' ? { name: postData.author, id: '', bio: '', avatar: '' } : postData.author
            } as any;
            finalQuestion = postData;
        }

        // 更新数据 (React 会自动对比，如果一样就不会闪烁)
        if (finalQuestion) setQuestion(finalQuestion);
        if (finalAnswer) setAnswer(finalAnswer);

      } catch (error: any) {
        console.error('更新数据失败:', error);
        // 如果是静默更新失败了，其实用户看着旧数据也行，不用报错
        if (!question) setErrorMsg(error.message || '加载失败');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [postId, fromQuestionId]); // 依赖项里去掉 question 和 answer，防止死循环

  // ... 渲染逻辑开始 ...

  // 1. 如果还在加载（说明没缓存且API没回来），显示骨架屏或 Loading
  // 建议：把 page.tsx 里的 Skeleton 拿过来，不要显示 "加载中 ID..." 这种文字
  if (loading) {
      return (
        <div className="min-h-screen bg-[#f6f6f6] pt-14">
             {/* 简单的骨架屏占位，避免白屏 */}
             <div className="max-w-[1000px] mx-auto mt-3 bg-white p-6 shadow-sm h-[400px] animate-pulse">
                <div className="h-8 bg-gray-200 w-1/3 mb-4 rounded"></div>
                <div className="h-4 bg-gray-200 w-full mb-2 rounded"></div>
                <div className="h-4 bg-gray-200 w-full mb-2 rounded"></div>
                <div className="h-4 bg-gray-200 w-2/3 mb-2 rounded"></div>
             </div>
        </div>
      );
  }

  const theme = {
    bg: 'bg-[#fdfbf7]', 
    text: 'text-[#2c1810]',
    muted: 'text-[#8c7b75]'
};

  if (errorMsg) return <div className="min-h-screen bg-[#f6f6f6] flex items-center justify-center text-red-500">出错了: {errorMsg}</div>;
  if (!answer || !question) return <div className="min-h-screen bg-[#f6f6f6] flex items-center justify-center text-gray-500">内容不存在</div>;

  return (
    <div className={`min-h-screen ${theme.bg} pb-20`}>
      {/* 顶部导航：透明化处理 */}
      <div className={`sticky top-0 z-30 ${theme.bg}/90 backdrop-blur-md border-b border-[#e8e4d9]`}>
        <div className="max-w-[800px] mx-auto px-6 h-16 flex items-center justify-between">
           <button onClick={() => router.back()} className="text-[#5c4b45] hover:text-[#2c1810] flex items-center gap-2 transition-colors">
              <ArrowLeft className="w-5 h-5" /> 
           </button>
           <div className="flex-1 text-center px-4">
             <span className="font-serif font-bold text-[#2c1810] text-sm truncate block opacity-70">
                {question.title}
             </span>
           </div>
           <MoreHorizontal className="w-5 h-5 text-[#8c7b75]" />
        </div>
      </div>

      <div className="max-w-[800px] mx-auto mt-8 px-6 md:px-0">
          
          {/* 这里的布局不再分开 标题 和 内容，而是像一篇文章一样连贯 */}
          <div className="mb-10 text-center">
              <h1 className="text-3xl md:text-4xl font-serif font-bold text-[#1a0f0a] leading-tight mb-6 mt-4">
                  {question.title}
              </h1>
              <div className="flex items-center justify-center gap-2 text-sm text-[#8c7b75] font-serif italic">
                  <span>话题发起于 {new Date(question.created_at || Date.now()).toLocaleDateString()}</span>
              </div>
          </div>

          <article className="bg-white px-8 py-10 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] rounded-sm border border-[#f0eee6]">
              {/* 作者信息栏：放在文章顶部，更像专栏 */}
              <div className="flex items-center justify-between mb-8 pb-6 border-b border-[#f5f5f5]">
                  <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-[#f3f0e9] flex items-center justify-center text-[#5c4b45] font-bold text-lg border border-white shadow-sm overflow-hidden">
                          {answer.author?.avatar ? (
                                <img src={answer.author.avatar} className="w-full h-full object-cover" />
                            ) : (
                                answer.author?.name?.[0]
                            )}
                      </div>
                      <div>
                          <div className="font-serif font-bold text-[#2c1810] text-lg">{answer.author?.name}</div>
                          <div className="text-xs text-[#998a85]">{answer.author?.bio || '暂无介绍'}</div>
                      </div>
                  </div>
                  {/* 可以放个“关注”按钮 */}
                  <button className="text-[#8b4513] border border-[#8b4513] px-4 py-1 rounded-full text-xs hover:bg-[#8b4513] hover:text-white transition-all">
                      关注作者
                  </button>
              </div>

              {/* 正文：增加字号，增加行高 */}
              <div 
                className="rich-text-content text-[#2c1810] text-[17px] md:text-[18px] leading-[1.8] font-light tracking-wide space-y-6" 
                dangerouslySetInnerHTML={{ __html: answer.content }}
              ></div>
              
              <div className="mt-12 flex items-center justify-between pt-8 border-t border-[#f5f5f5]">
                  <div className="text-xs text-gray-400 font-serif italic">
                      编辑于 {new Date(answer.time).toLocaleString()}
                  </div>
                  <div className="flex gap-4">
                       {/* 交互按钮 */}
                       <button className="flex items-center gap-2 text-[#5c4b45] hover:text-[#8b4513]">
                          <ThumbsUp className="w-5 h-5" /> <span className="text-sm">{answer.votes || 0}</span>
                       </button>
                       <button className="flex items-center gap-2 text-[#5c4b45] hover:text-[#8b4513]">
                          <MessageCircle className="w-5 h-5" /> <span className="text-sm">{answer.comments || 0}</span>
                       </button>
                  </div>
              </div>
          </article>

          {/* 底部推荐或评论区占位 */}
          <div className="mt-10 mb-20 text-center">
              <div className="inline-block w-2 h-2 rounded-full bg-[#dcdcdc] mx-1"></div>
              <div className="inline-block w-2 h-2 rounded-full bg-[#dcdcdc] mx-1"></div>
              <div className="inline-block w-2 h-2 rounded-full bg-[#dcdcdc] mx-1"></div>
          </div>
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