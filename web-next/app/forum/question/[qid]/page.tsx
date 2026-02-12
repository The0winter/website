'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { 
  Plus, MoreHorizontal, ChevronDown, MessageCircle, User, ArrowLeft, Send, ThumbsUp
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
      await forumApi.addReply(qid, { content: replyContent.replace(/\n/g, '<br/>' ) });
      
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

  // 在 return 之前，我们可以定义一个“雅致”的主题色
  const theme = {
    bg: 'bg-[#fdfbf7]', // 羊皮纸背景
    card: 'bg-[#fffefc]', // 卡片背景
    textMain: 'text-[#2c1810]', // 近似墨色的深棕
    textSub: 'text-[#8c7b75]', // 浅棕灰色
    accent: 'text-[#8b4513]', // 强调色（皮革/木头色）
    border: 'border-[#e8e4d9]' // 柔和边框
  };

  return (
    <div className={`min-h-screen ${theme.bg} pb-10 font-sans`}>
      
      {/* === 顶部导航 === */}
      <div className={`sticky top-0 z-30 ${theme.bg}/95 backdrop-blur-sm border-b ${theme.border}`}>
         <div className="max-w-[900px] mx-auto px-6 h-16 flex items-center justify-between">
           <button onClick={() => router.back()} className={`${theme.textSub} hover:${theme.textMain} transition-colors flex items-center gap-2`}>
              <ArrowLeft className="w-5 h-5" /> 
              <span className="font-serif italic text-lg">Back</span>
           </button>
           <span className={`font-serif font-bold ${theme.textMain} text-lg tracking-wide truncate max-w-[500px]`}>
               {loading ? '翻阅中...' : question?.title}
           </span>
           <MoreHorizontal className={`w-6 h-6 ${theme.textSub} cursor-pointer hover:${theme.textMain}`} />
         </div>
      </div>

      <div className="max-w-[900px] mx-auto mt-6 px-4 md:px-0">
        
        {loading ? (
           <QuestionSkeleton />
        ) : !question ? (
           <div className="py-20 text-center text-gray-400 font-serif italic">此处空无一物...</div>
        ) : (
           <>
            {/* 📜 话题详情卡片 (不再像知乎那么紧凑，更像一张书页) */}
            <div className={`${theme.card} mb-6 p-8 rounded-lg shadow-[0_2px_15px_-3px_rgba(0,0,0,0.05)] border ${theme.border}`}>
               <div className="flex gap-3 mb-5">
                  {question.tags?.map((tag: string) => (
                      <span key={tag} className="px-3 py-1 rounded-sm text-xs font-serif tracking-wider bg-[#f0eee6] text-[#5c4b45]">
                         #{tag}
                      </span>
                  ))}
               </div>
               
               {/* 标题使用衬线体，模仿书籍章节标题 */}
               <h1 className={`text-3xl font-serif font-bold ${theme.textMain} mb-6 leading-tight tracking-tight`}>
                 {question.title}
               </h1>
               
               <div 
                 className={`${theme.textMain} text-[17px] leading-loose opacity-90 mb-8 font-light`}
                 dangerouslySetInnerHTML={{ __html: question.content || '' }} 
               />

               <div className={`flex items-center justify-between border-t ${theme.border} pt-6`}>
                   <div className="flex gap-4">
                       <button 
                         onClick={() => setShowEditor(!showEditor)}
                         className={`px-6 py-2 rounded-full text-sm transition-all duration-300 shadow-sm
                           ${showEditor 
                             ? 'bg-[#e5e5e5] text-gray-600' 
                             : 'bg-[#2c1810] text-[#fdfbf7] hover:bg-[#4a2c20]'}`}
                       >
                          <span className="font-serif tracking-wide">{showEditor ? '收起笔墨' : '撰写书评'}</span>
                       </button>
                   </div>
                   <div className={`text-sm ${theme.textSub} font-serif italic`}>
                       {question.views} 次阅读 · {question.comments} 条随笔
                   </div>
               </div>

               {/* 输入框样式微调 */}
               {showEditor && (
                 <div className="mt-6 animate-in fade-in slide-in-from-top-2">
                    <div className={`border ${theme.border} rounded-lg overflow-hidden bg-white`}>
                       <textarea
                        className="w-full h-40 p-4 outline-none text-base bg-transparent resize-none leading-relaxed placeholder:text-gray-300"
                        placeholder="留下你的真知灼见..."
                        value={replyContent}
                        onChange={(e) => setReplyContent(e.target.value)}
                        style={{ color: '#2c1810' }} 
                        />
                       <div className="bg-[#faf9f5] px-4 py-3 flex justify-end gap-3 border-t border-gray-100">
                            <button 
                              onClick={() => setShowEditor(false)}
                              className="text-gray-500 text-sm px-4 py-1.5 hover:text-gray-800"
                            >
                              暂存
                            </button>
                            <button 
                              onClick={handleSubmitReply}
                              className="bg-[#8b4513] text-white text-sm px-6 py-1.5 rounded-full hover:bg-[#a0522d] font-serif"
                            >
                              发布
                            </button>
                       </div>
                    </div>
                 </div>
               )}
            </div>

            {/* 💬 讨论列表头 */}
            <div className="flex items-center gap-4 px-2 pb-4 mb-2">
                <div className="h-[1px] flex-1 bg-[#e8e4d9]"></div>
                <span className={`font-serif italic ${theme.textSub} text-sm`}>共 {answers.length} 篇讨论</span>
                <div className="h-[1px] flex-1 bg-[#e8e4d9]"></div>
            </div>

            <div className="space-y-5">
                {answers.map(answer => (
                    <Link 
                    href={`/forum/${answer.id}?fromQuestion=${question.id}`} 
                    key={answer.id}
                    onClick={() => {/* 保持之前的缓存逻辑 */}}
                    // 改为卡片式布局，增加 hover 时的上浮效果
                    className={`${theme.card} p-6 rounded-lg border border-transparent hover:border-[#e8e4d9] shadow-sm hover:shadow-md transition-all duration-300 block group`}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-[#f0eee6] flex items-center justify-center border border-white shadow-inner text-[#5c4b45] font-serif font-bold">
                                {answer.author?.avatar ? (
                                    <img src={answer.author.avatar} alt="avatar" className="w-full h-full object-cover rounded-full"/>
                                ) : (
                                    answer.author?.name?.[0] || '书'
                                )}
                                </div>
                                <span className={`text-sm font-bold ${theme.textMain} opacity-80 group-hover:opacity-100`}>
                                    {answer.author?.name || '匿名书友'}
                                </span>
                            </div>
                            <span className="text-xs text-gray-400 font-mono opacity-50">{answer.time.split(' ')[0]}</span>
                        </div>

                        {/* 内容预览：增加行高，字体颜色更深 */}
                        <div 
                            className={`${theme.textMain} text-[15px] leading-7 mb-4 line-clamp-3 opacity-90`}
                            dangerouslySetInnerHTML={{ __html: answer.content }} 
                        >
                        </div>
                        
                        <div className="flex items-center gap-6 text-xs font-medium text-gray-400">
                            <span className="flex items-center gap-1.5 hover:text-[#8b4513] transition-colors">
                                <ThumbsUp className="w-3.5 h-3.5" /> {answer.votes || 0} 赞赏
                            </span>
                            <span className="flex items-center gap-1.5 hover:text-[#8b4513] transition-colors">
                                <MessageCircle className="w-3.5 h-3.5" /> {answer.comments || 0} 评论
                            </span>
                        </div>
                    </Link> 
                ))}
            </div>
           </>
        )}
      </div>
    </div>
  );
}