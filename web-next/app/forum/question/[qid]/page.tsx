'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
// ✅ 1. 引入 useParams
import { useRouter, useParams } from 'next/navigation'; 
import { 
  MessageSquare, Share2, Plus, MoreHorizontal, 
  ChevronDown, ArrowUp, MessageCircle, User, ArrowLeft 
} from 'lucide-react';
import { forumApi, ForumPost, ForumReply } from '@/lib/api';

// ✅ 2. 去掉 props 里的 params
export default function QuestionPage() { 
  const router = useRouter();
  // ✅ 3. 使用 hook 获取参数
  const params = useParams(); 
  // 拿到 qid (注意：params 可能包含 array，所以最好强转一下 string)
  const qid = params?.qid as string; 

  const [question, setQuestion] = useState<ForumPost | null>(null);
  const [answers, setAnswers] = useState<ForumReply[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // ✅ 4. 增加安全检查
    if (!qid) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        // ✅ 5. 这里用 qid 变量，而不是 params.qid
        const [qData, rData] = await Promise.all([
          forumApi.getById(qid),
          forumApi.getReplies(qid)
        ]);
        setQuestion(qData);
        setAnswers(rData);
      } catch (error) {
        console.error('加载问题失败:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [qid]);

  if (loading) return <div className="min-h-screen bg-[#f6f6f6] flex items-center justify-center text-gray-500">加载中...</div>;
  if (!question) return <div className="min-h-screen bg-[#f6f6f6] flex items-center justify-center text-gray-500">问题不存在</div>;

  return (
    <div className="min-h-screen bg-[#f6f6f6] pb-10">
      
      {/* 顶部导航 */}
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
        
        {/* 问题详情 */}
        <div className="bg-white mb-3 p-6 rounded-sm shadow-sm">
           <div className="flex gap-2 mb-3">
              {question.tags?.map((tag: string) => (
                  <span key={tag} className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-medium">
                      {tag}
                  </span>
              ))}
           </div>
           <h1 className="text-2xl font-bold text-gray-900 mb-4 leading-snug">{question.title}</h1>
           
           {/* 问题描述 (渲染 HTML) */}
           <div 
             className="text-gray-800 text-[15px] leading-relaxed mb-6"
             dangerouslySetInnerHTML={{ __html: question.content || '' }} 
           />

           <div className="flex items-center justify-between border-t border-gray-100 pt-4">
               <div className="flex gap-3">
                   <button className="bg-blue-600 text-white px-5 py-2 rounded-[4px] text-sm font-medium hover:bg-blue-700">
                      写回答
                   </button>
                   <button className="bg-blue-50 text-blue-600 px-4 py-2 rounded-[4px] text-sm font-medium flex items-center gap-1 hover:bg-blue-100">
                      <Plus className="w-4 h-4" /> 关注问题
                   </button>
               </div>
               <div className="text-xs text-gray-400">
                   {question.views} 浏览 · {question.comments} 讨论
               </div>
           </div>
        </div>

        {/* 回答列表 */}
        <div className="flex justify-between px-2 pb-2 text-sm text-gray-500">
            <span>{answers.length} 个回答</span>
            <span className="flex items-center gap-1 cursor-pointer">默认排序 <ChevronDown className="w-3 h-3"/></span>
        </div>

        <div className="flex flex-col gap-3">
            {answers.map(answer => (
                <Link 
                  // 🔥 点击跳转到单条回答详情页，带上 fromQuestion 参数方便返回
                  href={`/forum/${answer.id}?fromQuestion=${question.id}`} 
                  key={answer.id}
                  className="bg-white p-5 rounded-sm shadow-sm hover:shadow-md transition-shadow block"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
                            <User className="w-4 h-4 text-gray-400" />
                        </div>
                        <span className="text-sm font-bold text-gray-900">{answer.author.name}</span>
                    </div>

                    {/* 预览部分内容 */}
                    <div 
                        className="text-[15px] text-gray-800 leading-relaxed line-clamp-3 mb-3"
                        dangerouslySetInnerHTML={{ __html: answer.content }} // 注意：这里直接渲染可能会有样式问题，最好在后端生成一个 plain text preview
                    >
                    </div>
                    
                    <div className="flex items-center gap-4 text-gray-400 text-sm">
                        <span className="text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded text-xs">{answer.votes} 赞同</span>
                        <span className="flex items-center gap-1 hover:text-gray-600 transition-colors">
                            <MessageCircle className="w-4 h-4" /> {answer.comments} 条评论
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