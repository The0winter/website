'use client';

import { Suspense, useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, MoreHorizontal, ThumbsUp, MessageCircle, Share2, ChevronDown 
} from 'lucide-react';
import { forumApi, ForumPost, ForumReply } from '@/lib/api';

function PostContent() {
    console.log("🔥 我是最新修改的代码！！！如果不显示这行就是没更新！"); // <--- 加上这一句
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams(); 
  
  // 🔍 核心修复 1: 兼容获取 ID (不管文件夹叫 [id] 还是 [postId])
  // params 刚加载时可能是 null，所以要用 ?.
  const rawId = params?.postId || params?.id;
  const postId = Array.isArray(rawId) ? rawId[0] : rawId;

  const fromQuestionId = searchParams.get('fromQuestion');

  // 状态
  const [question, setQuestion] = useState<ForumPost | null>(null);
  const [answer, setAnswer] = useState<ForumReply | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    // 🔍 核心修复 2: 调试日志 (按 F12 看控制台)
    console.log('📌 页面参数检查:', { params, postId, fromQuestionId });

    const fetchData = async () => {
      // 🛑 核心修复 3: 绝对拦截！如果没有 ID，或者 ID 是 "undefined" 字符串，直接不跑！
      if (!postId || postId === 'undefined' || postId === 'null') {
          console.warn('⏳ 等待有效 ID...');
          return;
      }

      try {
        setLoading(true);
        setErrorMsg('');

        if (fromQuestionId && fromQuestionId !== 'undefined') {
            // 模式 A: 从问题跳过来的回答
            const [qData, replies] = await Promise.all([
                forumApi.getById(fromQuestionId),
                forumApi.getReplies(fromQuestionId)
            ]);
            setQuestion(qData);
            const targetAnswer = replies.find(r => r.id === postId);
            setAnswer(targetAnswer || null);
        } else {
            // 模式 B: 直接看帖子/文章
            console.log('🚀 发起请求 getById:', postId);
            const postData = await forumApi.getById(postId);
            
            // 构造显示数据
            setAnswer({
                id: postData.id,
                content: postData.content || '',
                votes: postData.votes,
                comments: postData.comments,
                time: postData.created_at || '',
                author: typeof postData.author === 'string' ? { name: postData.author, id: '', bio: '', avatar: '' } : postData.author
            } as any);
            setQuestion(postData);
        }

      } catch (error: any) {
        console.error('❌ 加载详情失败:', error);
        setErrorMsg(error.message || '加载失败');
      } finally {
        setLoading(false);
      }
    };

    // 只有当 postId 有值时，才执行
    if (postId) {
        fetchData();
    }
  }, [postId, fromQuestionId]);

  if (loading) return <div className="min-h-screen bg-[#f6f6f6] flex items-center justify-center text-gray-500">加载中... (ID: {postId})</div>;
  
  if (errorMsg) return <div className="min-h-screen bg-[#f6f6f6] flex items-center justify-center text-red-500">出错了: {errorMsg}</div>;

  if (!answer || !question) return <div className="min-h-screen bg-[#f6f6f6] flex items-center justify-center text-gray-500">内容不存在 (ID: {postId})</div>;

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

      {/* 内容卡片 */}
      <div className="max-w-[1000px] mx-auto mt-3">
          <div className="bg-white p-6 shadow-sm border border-gray-200 mb-3">
              <h1 className="text-2xl font-bold text-gray-900 leading-snug mb-4">
                  {question.title}
              </h1>
          </div>

          <div className="bg-white p-6 shadow-sm border border-gray-200 min-h-[500px]">
              <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center text-gray-500 font-bold">
                      {answer.author.name?.[0]?.toUpperCase()}
                  </div>
                  <div>
                      <div className="font-bold text-gray-900 text-[15px]">{answer.author.name}</div>
                  </div>
              </div>

              {/* 内容 */}
              <div className="rich-text-content text-gray-800 leading-7 space-y-4" dangerouslySetInnerHTML={{ __html: answer.content }}></div>
              
              <div className="text-sm text-gray-400 mt-8 mb-6">发布于 {new Date(answer.time).toLocaleString()}</div>
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