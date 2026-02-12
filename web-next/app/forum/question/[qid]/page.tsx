'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { 
  Plus, MoreHorizontal, ChevronDown, MessageCircle, User, ArrowLeft, Send, ThumbsUp, Settings, Share2
} from 'lucide-react';
import { forumApi, ForumPost, ForumReply } from '@/lib/api';

// 🎨 主题配置：现代极简白
const theme = {
  bg: 'bg-[#f8f9fa]',
  card: 'bg-white',
  textMain: 'text-gray-900',
  textSub: 'text-gray-500',
  border: 'border-gray-100',
  primaryBtn: 'bg-gray-900 text-white hover:bg-black shadow-md hover:shadow-lg',
  secondaryBtn: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50',
};

function QuestionSkeleton() {
  return (
    <div className={`${theme.card} p-8 rounded-xl shadow-sm animate-pulse border ${theme.border}`}>
      <div className="h-8 bg-gray-100 rounded-md w-3/4 mb-6"></div>
      <div className="h-4 bg-gray-100 rounded w-full mb-3"></div>
      <div className="h-4 bg-gray-100 rounded w-full mb-3"></div>
      <div className="h-4 bg-gray-100 rounded w-2/3 mb-8"></div>
      <div className="flex gap-4 pt-6 border-t border-gray-50">
        <div className="h-10 bg-gray-100 rounded-lg w-28"></div>
        <div className="h-10 bg-gray-100 rounded-lg w-28"></div>
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
      await forumApi.addReply(qid, { content: replyContent.replace(/\n/g, '<br/>' ) });
      setReplyContent('');
      setShowEditor(false);
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
    // 全局字体 font-sans (黑体)
    <div className={`min-h-screen ${theme.bg} pb-20 font-sans`}>
      
      {/* === 顶部导航 === */}
      <div className={`sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b ${theme.border}`}>
         <div className="max-w-[1000px] mx-auto px-4 h-16 flex items-center justify-between">
           <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-2">
              <ArrowLeft className="w-5 h-5" /> 
           </button>
           
           <span className="font-bold text-gray-900 truncate max-w-[500px] text-center text-[15px] opacity-90">
               {loading ? '加载中...' : question?.title}
           </span>
           
           <div className="flex gap-4">
             <button className="text-gray-400 hover:text-gray-900">
                <Settings className="w-5 h-5" />
             </button>
           </div>
         </div>
      </div>

      <div className="max-w-[1000px] mx-auto mt-6 px-4 md:px-0">
        
        {loading ? (
           <QuestionSkeleton />
        ) : !question ? (
           <div className={`${theme.card} p-12 text-center text-gray-400 rounded-xl`}>问题不存在</div>
        ) : (
           <>
            {/* 问题详情卡片 */}
            <div className={`${theme.card} mb-6 p-8 rounded-xl shadow-sm border ${theme.border}`}>
               <div className="flex gap-2 mb-4">
                  {question.tags?.map((tag: string) => (
                      <span key={tag} className="bg-gray-100 text-gray-600 px-3 py-1 rounded-md text-xs font-medium">
                         {tag}
                      </span>
                  ))}
               </div>
               
               <h1 className="text-[26px] font-bold text-gray-900 mb-6 leading-tight tracking-tight">{question.title}</h1>
               
               <div 
                 className="text-gray-800 text-[16px] leading-relaxed mb-8"
                 dangerouslySetInnerHTML={{ __html: question.content || '' }} 
               />

               <div className="flex items-center justify-between border-t border-gray-100 pt-6">
                   <div className="flex gap-3">
                       <button 
                         onClick={() => setShowEditor(!showEditor)}
                         className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 
                           ${showEditor ? 'bg-gray-100 text-gray-600' : theme.primaryBtn}`}
                       >
                          {showEditor ? '收起' : '写回答'}
                       </button>
                       <button className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${theme.secondaryBtn}`}>
                          <Plus className="w-4 h-4" /> 关注
                       </button>
                   </div>
                   <div className="text-xs text-gray-400 font-medium">
                       {question.views} 浏览 · {question.comments} 讨论
                   </div>
               </div>

               {/* 编辑器 */}
               {showEditor && (
                 <div className="mt-6 animate-in fade-in slide-in-from-top-2">
                    <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm ring-4 ring-gray-50">
                       <textarea
                        className="w-full h-40 p-4 outline-none text-base bg-white resize-none leading-relaxed placeholder:text-gray-300"
                        placeholder="撰写你的回答... (Ctrl + Enter 发布)"
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
                       <div className="bg-gray-50 px-4 py-3 flex justify-between items-center border-t border-gray-100">
                          <span className="text-xs text-gray-400">支持 Markdown 语法</span>
                          <div className="flex gap-3">
                            <button 
                              onClick={() => setShowEditor(false)}
                              className="text-gray-500 text-sm px-3 hover:text-gray-900"
                            >
                              取消
                            </button>
                            <button 
                              onClick={handleSubmitReply}
                              disabled={isSubmitting}
                              className={`bg-gray-900 text-white text-sm px-5 py-2 rounded-lg disabled:opacity-50 flex items-center gap-2 hover:bg-black transition-colors shadow-sm`}
                            >
                              {isSubmitting ? '提交中...' : <><Send className="w-3 h-3" /> 发布</>}
                            </button>
                          </div>
                       </div>
                    </div>
                 </div>
               )}
            </div>

            {/* 回答列表头 */}
            <div className="flex justify-between items-center px-2 pb-3">
                <span className="font-bold text-gray-900 text-base">{answers.length} 个回答</span>
                <span className="flex items-center gap-1 text-sm text-gray-500 cursor-pointer hover:text-gray-900">
                  默认排序 <ChevronDown className="w-4 h-4"/>
                </span>
            </div>

            <div className="flex flex-col gap-4">
                {answers.map(answer => (
                    <Link 
                    href={`/forum/${answer.id}?fromQuestion=${question.id}`} 
                    key={answer.id}
                    onClick={() => {
                        if (question) {
                            const cacheKey = `nav_cache_${answer.id}`;
                            const cacheData = { question, answer, timestamp: Date.now() };
                            sessionStorage.setItem(cacheKey, JSON.stringify(cacheData));
                        }
                    }}
                    className={`${theme.card} p-6 rounded-xl shadow-sm border border-transparent hover:border-gray-200 hover:shadow-md transition-all duration-300 block group`}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center overflow-hidden border border-gray-50">
                            {answer.author?.avatar ? (
                                <img src={answer.author.avatar} alt="avatar" className="w-full h-full object-cover"/>
                            ) : (
                                <User className="w-5 h-5 text-gray-400" />
                            )}
                            </div>
                            <span className="text-sm font-bold text-gray-900">{answer.author?.name || '匿名用户'}</span>
                        </div>

                        <div 
                            className="text-[15px] text-gray-700 leading-relaxed mb-4 line-clamp-3 group-hover:text-gray-900 transition-colors"
                            dangerouslySetInnerHTML={{ __html: answer.content }} 
                        >
                        </div>
                        
                        <div className="flex items-center gap-6 text-sm text-gray-400 font-medium">
                            <span className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-100 hover:text-blue-600 transition-colors">
                                <ThumbsUp className="w-4 h-4" /> {answer.votes || 0} 赞同
                            </span>
                            <span className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-100 hover:text-blue-600 transition-colors">
                                <MessageCircle className="w-4 h-4" /> {answer.comments || 0} 评论
                            </span>
                            <span className="text-xs ml-auto text-gray-300">{answer.time.split(' ')[0]}</span>
                        </div>
                    </Link> 
                ))}
                
                {answers.length === 0 && (
                    <div className="py-12 text-center text-gray-400">暂无回答，来做第一个分享者吧</div>
                )}
            </div>
           </>
        )}
      </div>
    </div>
  );
}