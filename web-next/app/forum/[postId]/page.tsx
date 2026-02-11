'use client';

import { Suspense, useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  MessageSquare, Share2, Star, Plus, ChevronDown, MessageCircle, 
  ArrowLeft, MoreHorizontal, ThumbsUp, Heart 
} from 'lucide-react';
import { forumApi, ForumPost, ForumReply } from '@/lib/api';

// === 子组件：内容展示 ===
function PostContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  
  // URL 参数
  const postId = params.postId as string; // 这是“回答ID”
  const fromQuestionId = searchParams.get('fromQuestion'); // 这是“问题ID”

  // 状态
  const [question, setQuestion] = useState<ForumPost | null>(null);
  const [answer, setAnswer] = useState<ForumReply | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        if (fromQuestionId) {
            // 场景 A: 这是一个“回答”，我们有来源问题 ID
            const [qData, replies] = await Promise.all([
                forumApi.getById(fromQuestionId),
                forumApi.getReplies(fromQuestionId)
            ]);
            setQuestion(qData);
            // 在所有回答里找到当前这个
            const targetAnswer = replies.find(r => r.id === postId);
            setAnswer(targetAnswer || null);
        } else {
            // 场景 B: 没有来源问题ID，可能是一个“文章”类型的帖子 (Post)
            // 尝试直接作为 Post 获取
            const postData = await forumApi.getById(postId);
            // 构造一个伪装的 "Answer" 格式来展示文章内容
            setAnswer({
                id: postData.id,
                content: postData.content || '',
                votes: postData.votes,
                comments: postData.comments,
                time: postData.created_at || '',
                author: typeof postData.author === 'object' ? postData.author : { name: 'Unknown', id: '', avatar: '', bio: '' }
            } as any);
            setQuestion(postData); // 把文章标题也作为 Question 标题展示
        }

      } catch (error) {
        console.error('加载详情失败:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [postId, fromQuestionId]);

  if (loading) return <div className="min-h-screen bg-[#f6f6f6] flex items-center justify-center text-gray-500">加载中...</div>;
  if (!answer || !question) return <div className="min-h-screen bg-[#f6f6f6] flex items-center justify-center text-gray-500">内容不存在</div>;

  return (
    <div className="min-h-screen bg-[#f6f6f6] pb-20">
      
      {/* 顶部导航 */}
      <div className="sticky top-0 z-30 bg-[#f6f6f6]">
        <div className="max-w-[1000px] mx-auto bg-white shadow-sm border-b border-x border-gray-200 px-4 h-14 flex items-center justify-between">
           <button onClick={() => router.back()} className="text-gray-500 hover:text-blue-600 flex items-center gap-1 text-sm font-bold">
              <ArrowLeft className="w-4 h-4" /> 返回
           </button>
           <span className="font-bold text-blue-600 text-lg hidden md:block">Novel Forum</span>
           <MoreHorizontal className="w-5 h-5 text-gray-400" />
        </div>
      </div>

      {/* 问题卡片 (简略版，点击跳回完整问题页) */}
      <div className="max-w-[1000px] mx-auto mt-3">
          <div className="bg-white p-6 shadow-sm border border-gray-200 mb-3">
              <div className="flex gap-2 mb-3">
                  {question.tags?.map((tag: string) => (
                      <span key={tag} className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-medium">
                          {tag}
                      </span>
                  ))}
              </div>

              {/* 点击标题跳回问题页 */}
              <Link 
                 href={`/forum/question/${question.id}`} 
                 className="block group"
              >
                  <h1 className="text-2xl font-bold text-gray-900 leading-snug group-hover:text-blue-600 transition-colors mb-4">
                      {question.title}
                  </h1>
              </Link>
              
              <div className="flex items-center gap-4">
                  <button className="bg-blue-600 text-white px-5 py-2 rounded-[4px] text-sm font-medium hover:bg-blue-700 transition-colors">
                      写回答
                  </button>
                  <Link 
                    href={`/forum/question/${question.id}`} 
                    className="bg-white border border-gray-300 text-gray-600 px-4 py-2 rounded-[4px] text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                      查看全部 {question.comments} 个回答
                  </Link>
              </div>
          </div>

          {/* 双栏布局 */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_296px] gap-3">
              
              {/* 左侧：回答详情 */}
              <div className="bg-white p-6 shadow-sm border border-gray-200 min-h-[500px]">
                  {/* 作者信息栏 */}
                  <div className="flex items-center gap-3 mb-6">
                      <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center text-gray-500 font-bold">
                          {answer.author.name?.[0]?.toUpperCase()}
                      </div>
                      <div>
                          <div className="font-bold text-gray-900 text-[15px]">{answer.author.name}</div>
                          <div className="text-xs text-gray-500">{answer.author.bio || '暂无介绍'}</div>
                      </div>
                  </div>

                  {/* 核心文章内容 (HTML渲染) */}
                  <div className="rich-text-content text-gray-800 leading-7 space-y-4" dangerouslySetInnerHTML={{ __html: answer.content }}></div>
                  
                  <div className="text-sm text-gray-400 mt-8 mb-6">发布于 {answer.time}</div>

                  {/* 底部悬浮操作栏 */}
                  <div className="sticky bottom-0 bg-white/95 backdrop-blur-sm pt-4 pb-2 border-t border-gray-100 flex items-center gap-4 -mx-6 px-6">
                      <button className="flex items-center gap-1 bg-blue-50 text-blue-600 px-4 py-2 rounded text-sm font-medium hover:bg-blue-100 transition-colors">
                          <ThumbsUp className="w-4 h-4 fill-current" />
                          赞同 {answer.votes}
                      </button>
                      <button className="flex items-center gap-1 bg-gray-50 text-gray-500 px-4 py-2 rounded text-sm font-medium hover:bg-gray-100 transition-colors">
                          <ChevronDown className="w-4 h-4" />
                      </button>
                      
                      <div className="flex items-center gap-6 ml-auto text-gray-500 text-sm font-medium">
                           <button className="flex items-center gap-1.5 hover:text-gray-700">
                              <MessageCircle className="w-5 h-5" /> 评论
                           </button>
                           <button className="flex items-center gap-1.5 hover:text-gray-700">
                               <Share2 className="w-5 h-5" /> 分享
                           </button>
                      </div>
                  </div>
              </div>

              {/* 右侧：侧边栏 (作者信息) */}
              <div className="hidden md:flex flex-col gap-3">
                  <div className="bg-white p-4 shadow-sm border border-gray-200">
                      <h3 className="font-bold text-gray-800 text-sm mb-3">关于作者</h3>
                      <div className="flex items-center gap-3 mb-3">
                           <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                                {answer.author.name?.[0]}
                           </div>
                           <div>
                               <div className="font-bold text-gray-900">{answer.author.name}</div>
                           </div>
                      </div>
                      <div className="flex gap-2">
                          <button className="flex-1 bg-blue-600 text-white text-sm py-1.5 rounded hover:bg-blue-700 transition-colors">
                              + 关注
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      </div>
    </div>
  );
}

// 导出组件
export default function PostDetailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f6f6f6]"></div>}>
       <PostContent />
    </Suspense>
  );
}