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

  if (loading) return <div className="min-h-screen bg-[#f6f6f6] flex items-center justify-center text-gray-500">加载中...</div>;
  if (!question) return <div className="min-h-screen bg-[#f6f6f6] flex items-center justify-center text-gray-500">问题不存在</div>;

  return (
    <div className="min-h-screen bg-[#f6f6f6] pb-10">
      
      {/* 顶部导航 (保持不变) */}
      <div className="sticky top-0 z-30 bg-[#f6f6f6]">
         <div className="max-w-[1000px] mx-auto bg-white shadow-sm border-b border-x border-gray-200 px-4 h-14 flex items-center justify-between">
           <button onClick={() => router.back()} className="text-gray-500 font-bold text-sm hover:text-blue-600 transition-colors flex items-center gap-1">
              <ArrowLeft className="w-4 h-4" /> 返回
           </button>
           <span className="font-bold text-gray-900 truncate max-w-[500px] text-center text-sm">
               {question.title}
           </span>
           <MoreHorizontal className="w-5 h-5 text-gray-400 cursor-pointer hover:text-gray-600" />
         </div>
      </div>

      <div className="max-w-[1000px] mx-auto mt-3 px-4 md:px-0">
        
        {/* 问题详情卡片 */}
        <div className="bg-white mb-3 p-6 rounded-sm shadow-sm">
           <div className="flex gap-2 mb-3">
              {question.tags?.map((tag: string) => (
                  <span key={tag} className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-medium">
                      {tag}
                  </span>
              ))}
           </div>
           <h1 className="text-2xl font-bold text-gray-900 mb-4 leading-snug">{question.title}</h1>
           
           <div 
             className="text-gray-800 text-[15px] leading-relaxed mb-6"
             dangerouslySetInnerHTML={{ __html: question.content || '' }} 
           />

           <div className="flex items-center justify-between border-t border-gray-100 pt-4">
               <div className="flex gap-3">
                   {/* 🔥 修改：点击按钮切换显示输入框 */}
                   <button 
                     onClick={() => setShowEditor(!showEditor)}
                     className={`px-5 py-2 rounded-[4px] text-sm font-medium transition-colors ${showEditor ? 'bg-gray-100 text-gray-600' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                   >
                      {showEditor ? '收起回答' : '写回答'}
                   </button>
                   
                   <button className="bg-blue-50 text-blue-600 px-4 py-2 rounded-[4px] text-sm font-medium flex items-center gap-1 hover:bg-blue-100">
                      <Plus className="w-4 h-4" /> 关注问题
                   </button>
               </div>
               <div className="text-xs text-gray-400">
                   {question.views} 浏览 · {question.comments} 讨论
               </div>
           </div>

           {/* 🔥 新增：回答输入区域 (折叠式) */}
           {showEditor && (
             <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="border border-blue-200 rounded-md overflow-hidden shadow-sm">
                   <textarea
                     className="w-full h-32 p-3 outline-none text-sm resize-none bg-blue-50/30 focus:bg-white transition-colors"
                     placeholder="撰写你的回答... (支持 Markdown 语法)"
                     value={replyContent}
                     onChange={(e) => setReplyContent(e.target.value)}
                     autoFocus
                   />
                   <div className="bg-gray-50 px-3 py-2 flex justify-between items-center border-t border-gray-100">
                      <span className="text-xs text-gray-400">支持 Ctrl + Enter 发送</span>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setShowEditor(false)}
                          className="text-gray-500 text-sm px-3 py-1 hover:text-gray-700"
                        >
                          取消
                        </button>
                        <button 
                          onClick={handleSubmitReply}
                          disabled={isSubmitting}
                          className="bg-blue-600 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50 flex items-center gap-1"
                        >
                          {isSubmitting ? '提交中...' : <><Send className="w-3 h-3" /> 发布回答</>}
                        </button>
                      </div>
                   </div>
                </div>
             </div>
           )}
        </div>

        {/* 回答列表 (保持不变) */}
        <div className="flex justify-between px-2 pb-2 text-sm text-gray-500">
            <span>{answers.length} 个回答</span>
            <span className="flex items-center gap-1 cursor-pointer">默认排序 <ChevronDown className="w-3 h-3"/></span>
        </div>

        <div className="flex flex-col gap-3">
            {answers.map(answer => (
                <Link 
                  href={`/forum/${answer.id}?fromQuestion=${question.id}`} 
                  key={answer.id}
                  className="bg-white p-5 rounded-sm shadow-sm hover:shadow-md transition-shadow block"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
                           {/* 简单的头像占位 */}
                           {answer.author?.avatar ? (
                             <img src={answer.author.avatar} alt="avatar" />
                           ) : (
                             <User className="w-4 h-4 text-gray-400" />
                           )}
                        </div>
                        <span className="text-sm font-bold text-gray-900">{answer.author?.name || '匿名用户'}</span>
                    </div>

                    <div 
                        className="text-[15px] text-gray-800 leading-relaxed line-clamp-3 mb-3"
                        dangerouslySetInnerHTML={{ __html: answer.content }} 
                    >
                    </div>
                    
                    <div className="flex items-center gap-4 text-gray-400 text-sm">
                        <span className="text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded text-xs">{answer.votes || 0} 赞同</span>
                        <span className="flex items-center gap-1 hover:text-gray-600 transition-colors">
                            <MessageCircle className="w-4 h-4" /> {answer.comments || 0} 条评论
                        </span>
                        <span className="text-xs">{answer.time}</span>
                    </div>
                </Link>
            ))}
            
            {answers.length === 0 && (
                <div className="bg-white p-10 text-center text-gray-400">暂无回答，快来抢沙发！</div>
            )}
        </div>
      </div>
    </div>
  );
}