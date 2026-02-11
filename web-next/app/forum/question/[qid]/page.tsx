'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation'; // ✅ 确保用了 useParams
import Link from 'next/link';
import { 
  Plus, MoreHorizontal, ChevronDown, MessageCircle, User, ArrowLeft, Send, X 
} from 'lucide-react';
import { forumApi, ForumPost, ForumReply } from '@/lib/api';

export default function QuestionPage() {
  const router = useRouter();
  const params = useParams();
  const qid = params?.qid as string;

  const [question, setQuestion] = useState<ForumPost | null>(null);
  const [answers, setAnswers] = useState<ForumReply[]>([]);
  const [loading, setLoading] = useState(true);

  // 🔥 新增：回答相关的状态
  const [showEditor, setShowEditor] = useState(false); // 控制输入框显示
  const [replyContent, setReplyContent] = useState(''); // 回答内容
  const [isSubmitting, setIsSubmitting] = useState(false); // 提交中状态

  // 获取数据 (这部分保持你之前的逻辑)
  useEffect(() => {
    if (!qid) return;
    const fetchData = async () => {
      try {
        setLoading(true);
        const [qData, rData] = await Promise.all([
          forumApi.getById(qid),
          forumApi.getReplies(qid)
        ]);
        setQuestion(qData);
        setAnswers(rData);
      } catch (error) {
        console.error('加载失败:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [qid]);

  // 🔥 新增：提交回答的函数
  const handleSubmitReply = async () => {
    if (!replyContent.trim()) {
      alert("写点什么吧！");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. 调用 API (假设你的 api.ts 里还没有 addReply，我们下面会补上，或者直接用 fetch)
      // 如果你的 forumApi 没有 addReply 方法，请看代码下方的【补充说明】
      await forumApi.addReply(qid, { content: replyContent });

      // 2. 提交成功后：清空输入框、隐藏编辑器
      setReplyContent('');
      setShowEditor(false);
      
      // 3. 重新获取回答列表 (最简单的刷新数据方式)
      const newAnswers = await forumApi.getReplies(qid);
      setAnswers(newAnswers);

    } catch (error: any) {
      console.error(error);
      if (error.message?.includes('401')) {
        alert("请先登录再回答哦！");
        router.push('/login'); // 假设你的登录页是 /login
      } else {
        alert("发布失败，请重试");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!question) return <div className="min-h-screen bg-[#f6f6f6] flex items-center justify-center text-gray-500">问题不存在</div>;

// 在 QuestionPage 组件的 return 处修改：

return (
  <div className="min-h-screen bg-[#f6f6f6] pb-10">
    
    {/* === 1. 顶部导航 (永远显示，不随 loading 消失) === */}
    <div className="sticky top-0 z-30 bg-[#f6f6f6]">
       <div className="max-w-[1000px] mx-auto bg-white shadow-sm border-b border-x border-gray-200 px-4 h-14 flex items-center justify-between">
         <button onClick={() => router.back()} className="text-gray-500 font-bold text-sm hover:text-blue-600 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> 返回
         </button>
         {/* 如果还在加载，标题显示为空或者“加载中...” */}
         <span className="font-bold text-gray-900 truncate max-w-[500px] text-center text-sm">
             {loading ? '加载中...' : question?.title}
         </span>
         <MoreHorizontal className="w-5 h-5 text-gray-400" />
       </div>
    </div>

    {/* === 2. 主体内容 === */}
    <div className="max-w-[1000px] mx-auto mt-3 px-4 md:px-0">
      
      {/* 🔥 核心逻辑：如果正在 Loading，显示骨架屏；如果加载完了，显示真内容 */}
      {loading ? (
         // 显示骨架屏 (Loading 状态)
         <div className="bg-white mb-3 p-6 rounded-sm shadow-sm">
            <QuestionSkeleton />
         </div>
      ) : (
         // 显示真实数据 (Loaded 状态)
         question && (
           <>
             {/* ...这里放你原本的 <div className="bg-white ..."> 问题详情代码 ... */}
             <div className="bg-white mb-3 p-6 rounded-sm shadow-sm">
                <div className="flex gap-2 mb-3">
                    {question.tags?.map((tag: string) => (
                        <span key={tag} className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-medium">{tag}</span>
                    ))}
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-4 leading-snug">{question.title}</h1>
                <div 
                   className="text-gray-800 text-[15px] leading-relaxed mb-6"
                   dangerouslySetInnerHTML={{ __html: question.content || '' }} 
                />
                
                {/* ...原本的按钮和输入框代码... */}
                <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                   <div className="flex gap-3">
                       <button 
                         onClick={() => setShowEditor(!showEditor)}
                         className={`px-5 py-2 rounded-[4px] text-sm font-medium transition-colors ${showEditor ? 'bg-gray-100 text-gray-600' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                       >
                          {showEditor ? '收起回答' : '写回答'}
                       </button>
                       {/* ... */}
                   </div>
                   {/* ... */}
                </div>

                {/* 你的输入框组件放在这里 */}
                {showEditor && (
                    <div className="mt-4">
                       {/* ...就是上面修复过的 textarea 部分... */}
                    </div>
                )}
             </div>

             {/* 回答列表 */}
             <div className="flex justify-between px-2 pb-2 text-sm text-gray-500">
                <span>{answers.length} 个回答</span>
             </div>
             
             {/* 回答列表渲染... */}
             {/* ... */}
           </>
         )
      )}
      
      {/* 错误处理：如果加载完了但没数据 */}
      {!loading && !question && (
         <div className="bg-white p-10 text-center text-gray-400">问题不存在</div>
      )}

    </div>
  </div>
);
}

function QuestionSkeleton() {
  return (
    <div className="animate-pulse">
      {/* 模拟标题 */}
      <div className="h-8 bg-gray-200 rounded w-3/4 mb-4"></div>
      {/* 模拟内容 */}
      <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
      <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
      <div className="h-4 bg-gray-200 rounded w-2/3 mb-6"></div>
      {/* 模拟按钮 */}
      <div className="flex gap-3 pt-4 border-t border-gray-100">
        <div className="h-8 bg-gray-200 rounded w-20"></div>
        <div className="h-8 bg-gray-200 rounded w-20"></div>
      </div>
    </div>
  );
}