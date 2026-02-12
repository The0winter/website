'use client';

import { Suspense, useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, MoreHorizontal, ThumbsUp, MessageCircle, Share2, Settings, User, ChevronRight
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

  // 状态
  const [question, setQuestion] = useState<ForumPost | null>(null);
  const [answer, setAnswer] = useState<ForumReply | null>(null);
  const [otherAnswers, setOtherAnswers] = useState<ForumReply[]>([]); // 存储其他回答
  
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      if (!postId || postId === 'undefined') return;
      try {
        setLoading(true);
        
        let finalQuestion = null;
        let finalAnswer = null;
        let allReplies: ForumReply[] = [];

        // 逻辑：获取当前回答 + 所属问题 + 同问题的其他回答
        if (fromQuestionId && fromQuestionId !== 'undefined') {
            const [qData, replies] = await Promise.all([
                forumApi.getById(fromQuestionId),
                forumApi.getReplies(fromQuestionId)
            ]);
            finalQuestion = qData;
            allReplies = replies;
            finalAnswer = replies.find(r => r.id === postId) || null;
        } else {
            // 只有 postId 的情况 (假设能获取到问题信息)
            const postData = await forumApi.getById(postId); 
            finalQuestion = postData;
            if (postData.id) {
               try {
                 allReplies = await forumApi.getReplies(postData.id);
               } catch (e) { console.log('获取其他回答失败', e)}
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

        // 过滤出其他回答，并按点赞排序
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

  if (loading) return <div className={`min-h-screen ${theme.bg} pt-20 text-center text-gray-400`}>加载中...</div>;
  if (errorMsg) return <div className={`min-h-screen ${theme.bg} flex items-center justify-center text-red-500`}>出错: {errorMsg}</div>;
  if (!answer || !question) return <div className={`min-h-screen ${theme.bg} flex items-center justify-center text-gray-500`}>内容不存在</div>;

  return (
    <div className={`min-h-screen ${theme.bg} pb-20 font-sans`}>
      {/* 顶部导航 */}
      <div className={`sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b ${theme.border}`}>
        <div className="max-w-[800px] mx-auto px-4 h-16 flex items-center justify-between">
           <Link href="/forum" className="text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1">
              <ArrowLeft className="w-5 h-5" /> 
              <span className="font-bold text-sm">首页</span>
           </Link>
           <div className="flex-1"></div>
           <div className="flex gap-2">
              <button className="p-2 text-gray-400 hover:text-gray-900"><Share2 className="w-5 h-5" /></button>
              <button className="p-2 text-gray-400 hover:text-gray-900"><Settings className="w-5 h-5" /></button>
           </div>
        </div>
      </div>

      <div className="max-w-[800px] mx-auto mt-8 px-4 md:px-0">
          
          {/* 文章头部 (标题) */}
          <div className="mb-8">
              {/* 🔥 修改 1: 去掉 underline，只保留颜色变化 hover:text-blue-600 */}
              <Link href={`/forum/question/${question.id}`}>
                <h1 className="text-3xl font-bold text-gray-900 leading-tight mb-4 tracking-tight hover:text-blue-600 transition-colors cursor-pointer group">
                    {question.title}
                    <ChevronRight className="inline-block w-6 h-6 ml-1 text-gray-300 group-hover:text-blue-600 transition-colors mb-1" />
                </h1>
              </Link>

              <div className="flex gap-2">
                  {question.tags?.map((tag: string) => (
                      <span key={tag} className="bg-white border border-gray-200 text-gray-500 px-2 py-0.5 rounded text-xs font-medium">
                         {tag}
                      </span>
                  ))}
              </div>
          </div>

          {/* === 当前主要回答 === */}
          <article className={`${theme.card} p-8 md:p-10 shadow-sm rounded-xl border ${theme.border} mb-12`}>
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
                  <button className="text-gray-900 bg-gray-100 px-5 py-1.5 rounded-full text-sm font-bold hover:bg-gray-200 transition-colors">
                      关注
                  </button>
              </div>

              <div 
                className="rich-text-content text-gray-900 text-[17px] md:text-[18px] leading-[1.8] font-normal tracking-wide space-y-6" 
                dangerouslySetInnerHTML={{ __html: answer.content }}
              ></div>
              
              <div className="mt-12 pt-8 border-t border-gray-50 flex items-center justify-between">
                  <div className="text-sm text-gray-400">
                      发布于 {new Date(answer.time).toLocaleDateString()}
                  </div>
                  <div className="flex gap-6">
                       <button className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors">
                          <ThumbsUp className="w-5 h-5" /> <span className="font-bold">{answer.votes || 0}</span>
                       </button>
                       <button className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors">
                          <MessageCircle className="w-5 h-5" /> <span className="font-bold">{answer.comments || 0}</span>
                       </button>
                  </div>
              </div>
          </article>

          {/* === 🔥 修改 2: 其他回答 (流式直接展示) === */}
          {otherAnswers.length > 0 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                
                {/* 分割线：提示用户下面是其他人的回答 */}
                <div className="relative flex items-center justify-center mb-10">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-gray-200"></div>
                    </div>
                    <div className="relative bg-[#f8f9fa] px-4">
                        <span className="text-sm font-bold text-gray-400">更多回答 ({otherAnswers.length})</span>
                    </div>
                </div>

                {/* 循环渲染完整的回答卡片 */}
                <div className="flex flex-col gap-8">
                    {otherAnswers.map(item => (
                        <article 
                            key={item.id}
                            className={`${theme.card} p-8 md:p-10 shadow-sm rounded-xl border ${theme.border}`}
                        >
                            {/* 极简作者头 */}
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden">
                                        {item.author?.avatar ? (
                                            <img src={item.author.avatar} alt="avatar" className="w-full h-full object-cover"/>
                                        ) : (
                                            <span className="text-gray-400 font-bold text-sm">{item.author?.name?.[0]}</span>
                                        )}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold text-gray-900">{item.author?.name}</span>
                                        <span className="text-xs text-gray-400">{item.time.split(' ')[0]}</span>
                                    </div>
                                </div>
                            </div>
                            
                            {/* 完整内容渲染 */}
                            <div 
                                className="rich-text-content text-gray-900 text-[17px] leading-[1.8] font-normal tracking-wide space-y-4"
                                dangerouslySetInnerHTML={{ __html: item.content }}
                            ></div>

                            {/* 底部操作 */}
                            <div className="mt-8 pt-6 border-t border-gray-50 flex items-center gap-6 text-gray-400">
                                <button className="flex items-center gap-2 hover:text-gray-900 transition-colors">
                                    <ThumbsUp className="w-4 h-4" /> <span className="text-sm font-bold">{item.votes}</span>
                                </button>
                                <button className="flex items-center gap-2 hover:text-gray-900 transition-colors">
                                    <MessageCircle className="w-4 h-4" /> <span className="text-sm font-bold">{item.comments}</span>
                                </button>
                            </div>
                        </article>
                    ))}
                </div>
                
                {/* 到底提示 */}
                <div className="py-12 text-center text-gray-300 text-sm">
                    - 已加载全部回答 -
                </div>
            </div>
          )}

          {/* 底部留白 */}
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