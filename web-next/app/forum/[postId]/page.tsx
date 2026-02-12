'use client';

import { Suspense, useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { 
  ArrowLeft, MoreHorizontal, ThumbsUp, MessageCircle, Share2, Settings, User
} from 'lucide-react';
import { forumApi, ForumPost, ForumReply } from '@/lib/api';

// 🎨 主题配置
const theme = {
    bg: 'bg-[#f8f9fa]', 
    card: 'bg-white',
    text: 'text-gray-900',
    muted: 'text-gray-500',
    border: 'border-gray-100'
};

function PostContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams(); 
  
  const rawId = params?.postId || params?.id;
  const postId = (Array.isArray(rawId) ? rawId[0] : rawId) as string;
  const fromQuestionId = searchParams.get('fromQuestion');

  // 缓存读取逻辑
  const loadFromCache = () => {
    if (typeof window === 'undefined' || !postId) return null;
    try {
      const cacheKey = `nav_cache_${postId}`;
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) { console.error(e); }
    return null;
  };

  const initialData = loadFromCache();
  const [question, setQuestion] = useState<ForumPost | null>(initialData?.question || null);
  const [answer, setAnswer] = useState<ForumReply | null>(initialData?.answer || null);
  const [loading, setLoading] = useState(!initialData?.answer);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      if (!postId || postId === 'undefined' || postId === 'null') return;
      try {
        if (!question || !answer) setLoading(true);
        
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

        if (finalQuestion) setQuestion(finalQuestion);
        if (finalAnswer) setAnswer(finalAnswer);
      } catch (error: any) {
        if (!question) setErrorMsg(error.message || '加载失败');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [postId, fromQuestionId]);

  if (loading) {
      return (
        <div className={`min-h-screen ${theme.bg} pt-16`}>
             <div className="max-w-[800px] mx-auto bg-white p-8 rounded-xl shadow-sm h-[400px] animate-pulse">
                <div className="h-10 bg-gray-100 w-1/2 mb-6 rounded-md"></div>
                <div className="flex gap-4 mb-8">
                    <div className="w-10 h-10 bg-gray-100 rounded-full"></div>
                    <div className="flex-1">
                        <div className="h-4 bg-gray-100 w-32 mb-2 rounded"></div>
                        <div className="h-3 bg-gray-100 w-20 rounded"></div>
                    </div>
                </div>
                <div className="space-y-3">
                    <div className="h-4 bg-gray-100 w-full rounded"></div>
                    <div className="h-4 bg-gray-100 w-full rounded"></div>
                    <div className="h-4 bg-gray-100 w-3/4 rounded"></div>
                </div>
             </div>
        </div>
      );
  }
  
  if (errorMsg) return <div className={`min-h-screen ${theme.bg} flex items-center justify-center text-red-500`}>出错: {errorMsg}</div>;
  if (!answer || !question) return <div className={`min-h-screen ${theme.bg} flex items-center justify-center text-gray-500`}>内容不存在</div>;

  return (
    <div className={`min-h-screen ${theme.bg} pb-20 font-sans`}>
      {/* 顶部导航 */}
      <div className={`sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b ${theme.border}`}>
        <div className="max-w-[800px] mx-auto px-4 h-16 flex items-center justify-between">
           <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-2">
              <ArrowLeft className="w-5 h-5" /> 
           </button>
           <div className="flex-1 text-center px-4">
             <span className="font-bold text-gray-900 text-sm truncate block opacity-0 md:opacity-100 transition-opacity">
                {question.title}
             </span>
           </div>
           <div className="flex gap-2">
              <button className="p-2 text-gray-400 hover:text-gray-900"><Share2 className="w-5 h-5" /></button>
              <button className="p-2 text-gray-400 hover:text-gray-900"><Settings className="w-5 h-5" /></button>
           </div>
        </div>
      </div>

      <div className="max-w-[800px] mx-auto mt-8 px-4 md:px-0">
          
          {/* 文章头部 */}
          <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 leading-tight mb-4 tracking-tight">
                  {question.title}
              </h1>
              {/* 标签 */}
              <div className="flex gap-2">
                  {question.tags?.map((tag: string) => (
                      <span key={tag} className="bg-white border border-gray-200 text-gray-500 px-2 py-0.5 rounded text-xs font-medium">
                         {tag}
                      </span>
                  ))}
              </div>
          </div>

          <article className={`${theme.card} p-8 md:p-10 shadow-sm rounded-xl border ${theme.border}`}>
              {/* 作者信息栏 */}
              <div className="flex items-center justify-between mb-8 pb-6 border-b border-gray-50">
                  <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center border border-white shadow-sm overflow-hidden">
                          {answer.author?.avatar ? (
                                <img src={answer.author.avatar} className="w-full h-full object-cover" />
                            ) : (
                                <User className="w-6 h-6 text-gray-400" />
                            )}
                      </div>
                      <div>
                          <div className="font-bold text-gray-900 text-base">{answer.author?.name}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{answer.author?.bio || '暂无介绍'}</div>
                      </div>
                  </div>
                  <button className="text-blue-600 bg-blue-50 px-4 py-1.5 rounded-full text-sm font-medium hover:bg-blue-100 transition-colors">
                      关注
                  </button>
              </div>

              {/* 正文：字号 17px/18px，纯黑，黑体 */}
              <div 
                className="rich-text-content text-gray-900 text-[17px] md:text-[18px] leading-[1.8] font-normal tracking-wide space-y-6" 
                dangerouslySetInnerHTML={{ __html: answer.content }}
              ></div>
              
              <div className="mt-12 pt-8 border-t border-gray-50 flex items-center justify-between">
                  <div className="text-sm text-gray-400">
                      发布于 {new Date(answer.time).toLocaleString()}
                  </div>
                  
                  {/* 悬浮点赞栏也可以放在这里 */}
                  <div className="flex gap-6">
                       <button className="flex items-center gap-2 text-gray-500 hover:text-blue-600 transition-colors">
                          <ThumbsUp className="w-5 h-5" /> <span className="font-bold">{answer.votes || 0}</span>
                       </button>
                       <button className="flex items-center gap-2 text-gray-500 hover:text-blue-600 transition-colors">
                          <MessageCircle className="w-5 h-5" /> <span className="font-bold">{answer.comments || 0}</span>
                       </button>
                  </div>
              </div>
          </article>

          {/* 简单的结束符 */}
          <div className="mt-10 mb-20 text-center text-gray-200">
             - END -
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