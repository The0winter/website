// postpage.tsx 修改后的完整逻辑

'use client';

import { Suspense, useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, MoreHorizontal
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
  
  if (errorMsg) return <div className="min-h-screen bg-[#f6f6f6] flex items-center justify-center text-red-500">出错了: {errorMsg}</div>;
  if (!answer || !question) return <div className="min-h-screen bg-[#f6f6f6] flex items-center justify-center text-gray-500">内容不存在</div>;

  return (
    <div className="min-h-screen bg-[#f6f6f6] pb-20">
      {/* 顶部导航 */}
      <div className="sticky top-0 z-30 bg-[#f6f6f6]">
        <div className="max-w-[1000px] mx-auto bg-white shadow-sm border-b border-x border-gray-200 px-4 h-14 flex items-center justify-between">
           <button onClick={() => router.back()} className="text-gray-500 hover:text-blue-600 flex items-center gap-1 text-sm font-bold">
              <ArrowLeft className="w-4 h-4" /> 返回
           </button>
           {/* 标题过长可以截断 */}
           <span className="font-bold text-gray-900 text-sm truncate max-w-[200px] md:max-w-md hidden md:block">
               {question.title}
           </span>
           <MoreHorizontal className="w-5 h-5 text-gray-400" />
        </div>
      </div>

      {/* 内容卡片 */}
      <div className="max-w-[1000px] mx-auto mt-3 px-4 md:px-0">
          <div className="bg-white p-6 shadow-sm border border-gray-200 mb-3 rounded-sm">
              <h1 className="text-2xl font-bold text-gray-900 leading-snug mb-4">
                  {question.title}
              </h1>
              {/* 加上问题描述的预览，或者 tag，让详情页更丰满 */}
              <div className="flex gap-2">
                  {question.tags?.map((tag: string) => (
                      <span key={tag} className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-xs">
                         {tag}
                      </span>
                  ))}
              </div>
          </div>

          <div className="bg-white p-6 shadow-sm border border-gray-200 min-h-[500px] rounded-sm">
              <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center text-gray-500 font-bold overflow-hidden">
                      {answer.author?.avatar ? (
                          <img src={answer.author.avatar} className="w-full h-full object-cover" />
                      ) : (
                          answer.author?.name?.[0]?.toUpperCase()
                      )}
                  </div>
                  <div>
                      <div className="font-bold text-gray-900 text-[15px]">{answer.author?.name}</div>
                      <div className="text-xs text-gray-400">{answer.author?.bio || '暂无介绍'}</div>
                  </div>
              </div>

              <div className="rich-text-content text-gray-800 leading-7 space-y-4 text-[16px]" dangerouslySetInnerHTML={{ __html: answer.content }}></div>
              
              <div className="text-sm text-gray-400 mt-8 mb-6 pt-6 border-t border-gray-100">
                  发布于 {new Date(answer.time).toLocaleString()}
              </div>
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