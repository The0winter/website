'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  MessageSquare, Share2, Plus, MoreHorizontal, 
  ChevronDown, ArrowUp, MessageCircle, User 
} from 'lucide-react';

export default function QuestionPage({ params }: { params: { qid: string } }) {
  const router = useRouter();
  
  // 1. 模拟问题数据
  const question = {
    id: params.qid,
    title: "欧洲为什么能突破内卷？",
    description: "我看很多人说是因为地理大发现，也有人说是科技革命。但是本质上，为什么他们的社会形态允许这种突破？希望能从社会学和经济学角度分析。",
    tags: ["社会学", "经济发展", "欧洲历史"],
    viewCount: 34230,
    followCount: 120,
    answerCount: 45,
  };

  // 2. 模拟回答列表 (注意：内容很长，但稍后会被 CSS 截断)
  const answers = [
    {
      id: 101, // 回答ID
      author: "Steven汤圆",
      bio: "社会学博士在读",
      voteCount: 2336,
      commentCount: 450,
      preview: "因为欧美认真看透了财富的本质、人的意义。中国为什么这么内卷，本质上仍然是对财富没有清晰的认知... 揪其根源，是我们太过于这种“单一评价体系”。在欧洲，一个修水管的工人，他的社会地位并不比一个大学教授低..."
    },
    {
      id: 102,
      author: "历史的尘埃",
      bio: "欧洲史研究员",
      voteCount: 892,
      commentCount: 66,
      preview: "这个问题要从黑死病说起。当时欧洲人口锐减，导致劳动力极其昂贵。为了节省人力，技术革新成为了刚需。这与东亚长期的人口红利形成了鲜明对比..."
    },
    {
        id: 103,
        author: "匿名用户",
        bio: "",
        voteCount: 124,
        commentCount: 12,
        preview: "谢邀。人在美国，刚下飞机。利益相关，匿了。简单说两句，内卷的本质是存量博弈。当增量消失的时候..."
    }
  ];

return (
  <div className="min-h-screen bg-[#f6f6f6] pb-10">
    
{/* 🔥 修改 1: 外层透明 */}
    <div className="sticky top-0 z-30">
       {/* 🔥 修改 2: 内层白色、阴影、圆角 */}
       <div className="max-w-[1000px] mx-auto bg-white shadow-sm border-b border-x border-gray-200 px-4 h-14 flex items-center justify-between rounded-b-lg">
         <button onClick={() => router.back()} className="text-gray-500 font-bold text-sm hover:text-blue-600 transition-colors">
            ← 返回
         </button>
         
         {/* 标题截断优化 */}
         <span className="font-bold text-gray-900 truncate max-w-[600px] text-center">
             {question.title}
         </span>
         
         <MoreHorizontal className="w-5 h-5 text-gray-500 cursor-pointer" />
       </div>
    </div>

    {/* 主体内容：限制最大宽度 1000px 并居中 */}
    <div className="max-w-[1000px] mx-auto mt-3 px-4">
      
      {/* === 核心区域1：问题详情 === */}
      <div className="bg-white mb-3 p-6 rounded-sm shadow-sm">
         {/* ... (这里的内容保持不变，因为外层已经限制了宽度) ... */}
         <div className="flex gap-2 mb-3">
            {question.tags.map(tag => (
                <span key={tag} className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-medium">
                    {tag}
                </span>
            ))}
         </div>
         <h1 className="text-2xl font-bold text-gray-900 mb-4 leading-snug">{question.title}</h1>
         
         <p className="text-gray-800 text-[15px] leading-relaxed mb-6">
             {question.description}
         </p>

         {/* ... 按钮组保持不变 ... */}
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
                 {question.viewCount} 浏览 · {question.followCount} 关注
             </div>
         </div>
      </div>

      {/* === 核心区域2：回答列表 === */}
      <div className="flex justify-between px-2 pb-2 text-sm text-gray-500">
          <span>{question.answerCount} 个回答</span>
          <span className="flex items-center gap-1 cursor-pointer">默认排序 <ChevronDown className="w-3 h-3"/></span>
      </div>

      <div className="flex flex-col gap-3">
          {answers.map(answer => (
              <Link 
                href={`/forum/${answer.id}?fromQuestion=${question.id}`} 
                key={answer.id}
                className="bg-white p-5 rounded-sm shadow-sm hover:shadow-md transition-shadow block"
              >
                  {/* ... 卡片内部代码保持不变 ... */}
                  <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
                          <User className="w-4 h-4 text-gray-400" />
                      </div>
                      <span className="text-sm font-bold text-gray-900">{answer.author}</span>
                      {answer.bio && <span className="text-xs text-gray-400 truncate max-w-[300px] border-l border-gray-300 pl-2 ml-1">{answer.bio}</span>}
                  </div>

                  <div className="text-[15px] text-gray-800 leading-relaxed line-clamp-3 mb-3">
                      {answer.preview}
                  </div>
                  
                  <div className="flex items-center gap-4 text-gray-400 text-sm">
                      <span className="text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded text-xs">{answer.voteCount} 赞同</span>
                      <span className="flex items-center gap-1 hover:text-gray-600 transition-colors">
                          <MessageCircle className="w-4 h-4" /> {answer.commentCount} 条评论
                      </span>
                  </div>
              </Link>
          ))}
      </div>
      
    </div>
  </div>
);
}