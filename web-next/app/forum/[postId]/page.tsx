'use client';

import { Suspense, useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { 
  ArrowLeft, MoreHorizontal, ThumbsUp, MessageCircle, Share2, User 
} from 'lucide-react';
import { forumApi } from '@/lib/api';

// 💀 1. 骨架屏组件
function PostSkeleton() {
  return (
    <div className="min-h-screen bg-[#f6f6f6]">
      <div className="sticky top-0 z-30 bg-white shadow-sm border-b border-gray-200 h-14"></div>
      <div className="max-w-[1000px] mx-auto mt-3 px-4 md:px-0">
        <div className="bg-white p-6 shadow-sm border border-gray-200 rounded-sm animate-pulse">
           <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
              <div className="h-4 bg-gray-200 rounded w-32"></div>
           </div>
           <div className="h-8 bg-gray-200 rounded w-3/4 mb-6"></div>
           <div className="space-y-3">
              <div className="h-4 bg-gray-200 rounded w-full"></div>
              <div className="h-4 bg-gray-200 rounded w-full"></div>
              <div className="h-4 bg-gray-200 rounded w-full"></div>
           </div>
        </div>
      </div>
    </div>
  );
}

// 📄 2. 内容组件
function PostContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams(); 
  
  // 获取 URL 中的 ID
  const rawId = params?.postId || params?.id;
  const postId = Array.isArray(rawId) ? rawId[0] : rawId;
  const fromQuestionId = searchParams.get('fromQuestion');
    const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // 加载数据
  useEffect(() => {
    if (!postId) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setErrorMsg('');

        // 🔥 核心修复逻辑：区分“回答”和“帖子”
        if (fromQuestionId && fromQuestionId !== 'undefined') {
            // === 情况 A: 这是一个回答 ===
            // 逻辑：先获取父问题信息，再获取所有回答，从中找到当前这个
            console.log("正在加载回答，所属问题ID:", fromQuestionId);
            
            const [parentQuestion, allReplies] = await Promise.all([
                forumApi.getById(fromQuestionId),
                forumApi.getReplies(fromQuestionId)
            ]);

            // 在回答列表里找到当前这个回答
            const targetReply = allReplies.find((r: any) => r.id === postId);

            if (targetReply) {
                setPost({
                    ...targetReply,
                    // 借用父问题的标题，并在前面加上前缀
                    title: `回复：${parentQuestion.title}`,
                    type: 'answer',
                    // 统一字段名，防止报错
                    likes: targetReply.votes || targetReply.likes || 0,
                    replyCount: targetReply.comments || 0,
                    created_at: targetReply.time || targetReply.createdAt
                });
            } else {
                throw new Error("未找到该回答");
            }

        } else {
            // === 情况 B: 这是一个普通帖子/问题 ===
            const data = await forumApi.getById(postId);
            setPost(data);
        }

      } catch (error: any) {
        console.error('加载失败:', error);
        // 如果是 404，提示更友好一点
        if (error.message?.includes('404') || error.response?.status === 404) {
            setErrorMsg('内容不存在或已被删除');
        } else {
            setErrorMsg('加载出错，请稍后重试');
        }
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [postId, fromQuestionId]);

  // 渲染判断
  if (loading) return <PostSkeleton />;
  
  if (errorMsg || !post) {
    return (
      <div className="min-h-screen bg-[#f6f6f6] flex flex-col items-center justify-center text-gray-400 gap-4">
        <div>{errorMsg || '内容不存在'}</div>
        <button onClick={() => router.back()} className="text-blue-600 hover:underline">返回上一页</button>
      </div>
    );
  }

  // 数据清洗：处理 author 
  const safeAuthor = typeof post.author === 'string' 
    ? { name: '匿名用户', avatar: null, id: '' } 
    : { 
        name: post.author?.name || post.author?.username || '匿名用户', 
        avatar: post.author?.avatar || null,
        id: post.author?.id || ''
      };

  const postTime = post.created_at || post.createdAt || post.time;
  const displayTime = postTime ? new Date(postTime).toLocaleString() : '刚刚';

  // 兼容互动字段
  const likeCount = post.likes || post.votes || 0;
  const commentCount = post.replyCount || post.comments || 0;

  return (
    <div className="min-h-screen bg-[#f6f6f6] pb-20">
      {/* 顶部导航 */}
      <div className="sticky top-0 z-30 bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-[1000px] mx-auto px-4 h-14 flex items-center justify-between">
           <button 
             onClick={() => fromQuestionId ? router.push(`/forum/question/${fromQuestionId}`) : router.back()} 
             className="text-gray-500 hover:text-blue-600 flex items-center gap-1 text-sm font-bold transition-colors"
           >
              <ArrowLeft className="w-5 h-5" /> 
              {fromQuestionId ? '返回问题' : '返回'}
           </button>
           <span className="font-bold text-gray-900 text-sm hidden md:block truncate max-w-[200px]">
             {post.type === 'answer' ? '回答详情' : '问题详情'}
           </span>
           <MoreHorizontal className="w-5 h-5 text-gray-400 cursor-pointer hover:text-gray-600" />
        </div>
      </div>

      {/* 内容卡片 */}
      <div className="max-w-[1000px] mx-auto mt-3 px-4 md:px-0">
          <div className="bg-white p-6 shadow-sm border border-gray-200 rounded-sm min-h-[500px]">
              
              {/* 作者信息 */}
              <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden border border-gray-100">
                      {safeAuthor.avatar ? (
                          <img src={safeAuthor.avatar} alt="avatar" className="w-full h-full object-cover"/>
                      ) : (
                          <User className="w-6 h-6 text-gray-400" />
                      )}
                  </div>
                  <div>
                      <div className="font-bold text-gray-900 text-[15px]">
                        {safeAuthor.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {displayTime}
                      </div>
                  </div>
              </div>

              {/* 标题 (只有当它是帖子时才显示大标题，回答通常不需要) */}
              {post.type !== 'answer' && post.title && (
                  <h1 className="text-2xl font-bold text-gray-900 leading-snug mb-6">{post.title}</h1>
              )}
              
              {/* 如果是回答，可以显示一个小提示是针对哪个问题的 */}
              {post.type === 'answer' && (
                  <div className="mb-4 text-sm text-gray-500 bg-gray-50 p-2 rounded">
                      {post.title}
                  </div>
              )}

              {/* 正文内容 */}
              <div 
                className="rich-text-content text-gray-800 leading-8 text-[16px] space-y-4" 
                dangerouslySetInnerHTML={{ __html: post.content || '' }}
              ></div>
              
              {/* 底部互动栏 */}
              <div className="flex gap-4 border-t border-gray-100 pt-6 mt-8">
                  <button className="flex items-center gap-1.5 bg-blue-100 text-blue-600 px-4 py-2 rounded font-medium hover:bg-blue-200 transition-colors">
                      <ThumbsUp className="w-4 h-4" /> 赞同 {likeCount}
                  </button>
                  <button className="flex items-center gap-1.5 text-gray-500 hover:text-gray-900 font-medium px-4 py-2 hover:bg-gray-50 rounded transition-colors">
                      <MessageCircle className="w-5 h-5" /> {commentCount} 条评论
                  </button>
                  <button className="flex items-center gap-1.5 text-gray-500 hover:text-gray-900 font-medium px-4 py-2 ml-auto hover:bg-gray-50 rounded transition-colors">
                      <Share2 className="w-5 h-5" /> 分享
                  </button>
              </div>
          </div>
      </div>
    </div>
  );
}

// 🚀 3. 主页面入口
export default function PostDetailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f6f6f6]"></div>}>
       <PostContent />
    </Suspense>
  );
}