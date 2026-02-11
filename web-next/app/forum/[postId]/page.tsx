'use client';

import { Suspense, useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { 
  ArrowLeft, MoreHorizontal, ThumbsUp, MessageCircle, Share2, User 
} from 'lucide-react';
import { forumApi } from '@/lib/api';

// 💀 1. 骨架屏组件 (加载时显示)
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
              <div className="h-4 bg-gray-200 rounded w-2/3"></div>
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

  // 🔥 核心修改：使用 <any> 绕过 TypeScript 的严格检查
  // 这样无论 post 里有什么字段 (likes, votes, created_at) 都不会报错
  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // 加载数据
  useEffect(() => {
    if (!postId) return;
    const fetchData = async () => {
      try {
        setLoading(true);
        const data = await forumApi.getById(postId);
        setPost(data);
      } catch (error: any) {
        console.error('加载失败:', error);
        setErrorMsg('内容加载失败，可能已被删除');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [postId]);

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

  // 数据清洗：处理 author 可能是字符串或对象的情况
  const safeAuthor = typeof post.author === 'string' 
    ? { name: '匿名用户', avatar: null, id: '' } 
    : { 
        name: post.author?.name || post.author?.username || '匿名用户', 
        avatar: post.author?.avatar || null,
        id: post.author?.id || ''
      };

  // 兼容时间字段 (后端可能是 createdAt 也可能是 created_at)
  const postTime = post.created_at || post.createdAt;
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
           <span className="font-bold text-gray-900 text-sm hidden md:block">
             {post.type === 'question' ? '问题详情' : '回答详情'}
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

              {/* 标题 */}
              {post.title && <h1 className="text-2xl font-bold text-gray-900 leading-snug mb-6">{post.title}</h1>}

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

// 🚀 3. 主页面入口 (导出)
export default function PostDetailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f6f6f6]"></div>}>
       <PostContent />
    </Suspense>
  );
}