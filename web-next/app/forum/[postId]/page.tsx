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
  // 新增：存储该问题下的其他回答
  const [otherAnswers, setOtherAnswers] = useState<ForumReply[]>([]);
  
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

        // 无论从哪里进来的，为了底部的“更多回答”，我们最好都获取一下列表
        if (fromQuestionId && fromQuestionId !== 'undefined') {
            const [qData, replies] = await Promise.all([
                forumApi.getById(fromQuestionId),
                forumApi.getReplies(fromQuestionId)
            ]);
            finalQuestion = qData;
            allReplies = replies;
            finalAnswer = replies.find(r => r.id === postId) || null;
        } else {
            // 如果是直接进来的，先获取当前内容，再尝试获取所属问题的信息
            // 注：这里假设 getById 返回的是 Post (问题) 或者 Reply (回答)
            // 实际业务中可能需要根据 ID 类型判断。这里为了简化，我们假设 API 逻辑如下：
            // 如果 postId 是回答 ID，我们需要知道它是哪个问题的。
            // 暂时沿用你之前的逻辑，但在获取完 answer 后，我们需要获取同问题的其他 reply
            
            // *为了简化逻辑并保证“更多回答”能出来，建议统一逻辑：
            // 真实场景通常是：先拿 Answer -> 拿到 questionId -> 拿 Question 和 OtherAnswers
            // 这里我们简化：假设 API 能通过 postId 拿到它所属的 question
            
            // ⚠️ 临时方案：为了展示效果，我们假设当前就在某个问题下
            // 如果你 API 支持，这里应该 fetch(questionId) -> fetchReplies(questionId)
            const postData = await forumApi.getById(postId); 
            finalQuestion = postData; // 这里假设 postData 包含了问题信息
            
            // 尝试获取该问题的所有回答（为了底部推荐）
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

        // 🔥 过滤出“其他回答” (排除当前这个，并按点赞排序)
        if (allReplies.length > 0 && finalAnswer) {
            const others = allReplies
                .filter(r => r.id !== finalAnswer?.id)
                .sort((a, b) => (b.votes || 0) - (a.votes || 0)); // 按热度排
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
      {/* === 1. 顶部导航 (修改版) === */}
      <div className={`sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b ${theme.border}`}>
        <div className="max-w-[800px] mx-auto px-4 h-16 flex items-center justify-between">
           {/* 左侧：改为回首页 */}
           <Link href="/forum" className="text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1">
              <ArrowLeft className="w-5 h-5" /> 
              <span className="font-bold text-sm">首页</span>
           </Link>
           
           {/* 中间：留空，或者放一个 Logo */}
           <div className="flex-1"></div>

           <div className="flex gap-2">
              <button className="p-2 text-gray-400 hover:text-gray-900"><Share2 className="w-5 h-5" /></button>
              <button className="p-2 text-gray-400 hover:text-gray-900"><Settings className="w-5 h-5" /></button>
           </div>
        </div>
      </div>

      <div className="max-w-[800px] mx-auto mt-8 px-4 md:px-0">
          
          {/* === 2. 文章头部 (标题可点击) === */}
          <div className="mb-8">
              {/* 点击标题跳转到问题详情页 (查看所有回答) */}
              <Link href={`/forum/question/${question.id}`}>
                <h1 className="text-3xl font-bold text-gray-900 leading-tight mb-4 tracking-tight hover:text-blue-600 hover:underline decoration-2 underline-offset-4 transition-all cursor-pointer">
                    {question.title}
                    <ChevronRight className="inline-block w-6 h-6 ml-1 text-gray-400 mb-1" />
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

          {/* === 3. 当前回答卡片 === */}
          <article className={`${theme.card} p-8 md:p-10 shadow-sm rounded-xl border ${theme.border} mb-12`}>
              {/* 作者栏 */}
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

              {/* 正文 */}
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

          {/* === 4. 更多回答 (过渡区域) === */}
          {otherAnswers.length > 0 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                
                {/* 极简分割线 */}
                <div className="relative flex items-center justify-center mb-8">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-gray-200"></div>
                    </div>
                    <div className="relative bg-[#f8f9fa] px-4">
                        <span className="text-sm font-bold text-gray-400">更多讨论</span>
                    </div>
                </div>

                {/* 推荐列表 */}
                <div className="flex flex-col gap-4">
                    {otherAnswers.map(item => (
                        <Link 
                            key={item.id}
                            // 点击跳转到新的回答详情页 (替换当前 ID)
                            href={`/forum/${item.id}?fromQuestion=${question.id}`}
                            className="bg-white p-6 rounded-xl border border-transparent hover:border-gray-200 hover:shadow-md transition-all duration-300 block group"
                        >
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-sm font-bold text-gray-900">{item.author?.name}</span>
                                <span className="text-xs text-gray-400">· {item.time.split(' ')[0]}</span>
                            </div>
                            
                            <div className="text-gray-600 text-[15px] leading-relaxed line-clamp-2 group-hover:text-gray-900 transition-colors"
                                 dangerouslySetInnerHTML={{ __html: item.content }}
                            ></div>

                            <div className="mt-3 flex items-center gap-4 text-xs font-medium text-gray-400">
                                <span>{item.votes} 赞同</span>
                                <span>{item.comments} 评论</span>
                            </div>
                        </Link>
                    ))}
                    
                    {/* 查看全部按钮 */}
                    <Link 
                        href={`/forum/question/${question.id}`}
                        className="block text-center py-4 text-gray-500 hover:text-gray-900 text-sm font-bold transition-colors mt-2"
                    >
                        查看全部 {otherAnswers.length + 1} 个回答 &rarr;
                    </Link>
                </div>
            </div>
          )}

          {/* 底部留白 */}
          <div className="h-20"></div>
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