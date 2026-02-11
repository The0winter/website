'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { 
  Plus, MoreHorizontal, ChevronDown, MessageCircle, User, ArrowLeft, Send
} from 'lucide-react';
import { forumApi, ForumPost, ForumReply } from '@/lib/api';

// 💀 1. 把骨架屏组件提上来，或者放在文件底部都可以
function QuestionSkeleton() {
  return (
    <div className="bg-white p-6 rounded-sm shadow-sm animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-3/4 mb-4"></div>
      <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
      <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
      <div className="h-4 bg-gray-200 rounded w-2/3 mb-6"></div>
      <div className="flex gap-3 pt-4 border-t border-gray-100">
        <div className="h-8 bg-gray-200 rounded w-20"></div>
        <div className="h-8 bg-gray-200 rounded w-20"></div>
      </div>
    </div>
  );
}

export default function QuestionPage() {
  const router = useRouter();
  const params = useParams();
  const qid = params?.qid as string;

  const [question, setQuestion] = useState<ForumPost | null>(null);
  const [answers, setAnswers] = useState<ForumReply[]>([]);
  const [loading, setLoading] = useState(true);

  // 回答相关状态
  const [showEditor, setShowEditor] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 获取数据
  useEffect(() => {
    if (!qid) return;
    const fetchData = async () => {
      try {
        setLoading(true);
        // 使用 Promise.all 并行请求
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

  // 提交回答
  const handleSubmitReply = async () => {
    if (!replyContent.trim()) {
      alert("写点什么吧！");
      return;
    }

    setIsSubmitting(true);
    try {
      await forumApi.addReply(qid, { content: replyContent });
      
      setReplyContent('');
      setShowEditor(false);
      
      // 重新获取回答列表
      const newAnswers = await forumApi.getReplies(qid);
      setAnswers(newAnswers);
    } catch (error: any) {
      if (error.message?.includes('401')) {
        alert("请先登录再回答哦！");
        router.push('/login');
      } else {
        alert("发布失败，请重试");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f6f6] pb-10">
      
      {/* === 顶部导航 (始终显示) === */}
      <div className="sticky top-0 z-30 bg-[#f6f6f6]">
         <div className="max-w-[1000px] mx-auto bg-white shadow-sm border-b border-x border-gray-200 px-4 h-14 flex items-center justify-between">
           <button onClick={() => router.back()} className="text-gray-500 font-bold text-sm hover:text-blue-600 transition-colors flex items-center gap-1">
              <ArrowLeft className="w-4 h-4" /> 返回
           </button>
           <span className="font-bold text-gray-900 truncate max-w-[500px] text-center text-sm">
               {/* 加载时显示加载状态，加载完显示标题 */}
               {loading ? '加载中...' : question?.title}
           </span>
           <MoreHorizontal className="w-5 h-5 text-gray-400 cursor-pointer hover:text-gray-600" />
         </div>
      </div>

      <div className="max-w-[1000px] mx-auto mt-3 px-4 md:px-0">
        
        {/* 🔥 核心逻辑：这里决定是显示骨架屏，还是真实内容 */}
        {loading ? (
           // 1. Loading 状态 -> 显示骨架屏
           <QuestionSkeleton />
        ) : !question ? (
           // 2. 加载完了但没数据 -> 显示错误
           <div className="bg-white p-10 text-center text-gray-400">问题不存在</div>
        ) : (
           // 3. 有数据 -> 显示真实内容
           <>
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

               {/* 🔥 回答输入框 (去掉了可能导致隐身的动画类) */}
               {showEditor && (
                 <div className="mt-4">
                    <div className="border border-blue-200 rounded-md overflow-hidden shadow-sm">
                       <textarea
                        className="w-full h-32 p-3 outline-none text-base bg-white border-b border-gray-100 resize-none leading-relaxed"
                        placeholder="撰写你的回答... (Enter 换行，Ctrl + Enter 发布)"
                        value={replyContent}
                        onChange={(e) => setReplyContent(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.ctrlKey && e.key === 'Enter') {
                              e.preventDefault();
                              handleSubmitReply();
                            }
                        }}
                        style={{ color: '#111827' }} 
                        />
                       <div className="bg-gray-50 px-3 py-2 flex justify-between items-center">
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

            {/* 回答列表 */}
            <div className="flex justify-between px-2 pb-2 text-sm text-gray-500">
                <span>{answers.length} 个回答</span>
                <span className="flex items-center gap-1 cursor-pointer">默认排序 <ChevronDown className="w-3 h-3"/></span>
            </div>

            <div className="flex flex-col gap-3">
                {answers.map(answer => (
                    // 🔥 修改点：把 div 改回 Link，并加上 href
                    <Link 
                    href={`/forum/${answer.id}?fromQuestion=${question.id}`} // 你的原版链接逻辑
                    key={answer.id}
                    className="bg-white p-5 rounded-sm shadow-sm hover:shadow-md transition-shadow block" // 加上 block 让它占满一行
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
                            {answer.author?.avatar ? (
                                <img src={answer.author.avatar} alt="avatar" className="w-full h-full object-cover"/>
                            ) : (
                                <User className="w-4 h-4 text-gray-400" />
                            )}
                            </div>
                            <span className="text-sm font-bold text-gray-900">{answer.author?.name || '匿名用户'}</span>
                        </div>

                        <div 
                            // 这里的 line-clamp-3 会让过长的文字显示省略号
                            // 点击 Link 后应该跳转到详情页看全文
                            className="text-[15px] text-gray-800 leading-relaxed mb-3 line-clamp-3"
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
                    </Link> // 🔥 别忘了闭合标签也要改成 Link
                ))}
                
                {answers.length === 0 && (
                    <div className="bg-white p-10 text-center text-gray-400">暂无回答，快来抢沙发！</div>
                )}
            </div>
           </>
        )}

      </div>
    </div>
  );
}