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
      
      {/* 顶部导航 */}
      <div className="bg-white sticky top-0 z-30 border-b border-gray-200 px-4 h-12 flex items-center justify-between shadow-sm">
         <button onClick={() => router.back()} className="text-gray-500 font-bold text-sm">← 返回</button>
         <span className="font-bold text-gray-900 truncate max-w-[200px]">{question.title}</span>
         <MoreHorizontal className="w-5 h-5 text-gray-500" />
      </div>

      {/* === 核心区域1：问题详情 (顶部) === */}
      <div className="bg-white mb-3 p-5 shadow-sm">
         <div className="flex gap-2 mb-3">
            {question.tags.map(tag => (
                <span key={tag} className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-xs">
                    {tag}
                </span>
            ))}
         </div>
         <h1 className="text-xl font-bold text-gray-900 mb-3 leading-snug">{question.title}</h1>
         
         {/* 问题描述，支持展开/收起 (这里简化为直接显示) */}
         <p className="text-gray-600 text-sm leading-relaxed mb-4">
             {question.description}
         </p>

         <div className="flex items-center justify-between border-t border-gray-100 pt-4">
             <div className="flex gap-3">
                 <button className="bg-blue-600 text-white px-6 py-2 rounded text-sm font-bold hover:bg-blue-700">
                    写回答
                 </button>
                 <button className="bg-blue-50 text-blue-600 px-4 py-2 rounded text-sm font-bold flex items-center gap-1">
                    <Plus className="w-4 h-4" /> 关注问题
                 </button>
             </div>
             <div className="text-xs text-gray-400">
                 {question.viewCount} 浏览 · {question.followCount} 关注
             </div>
         </div>
      </div>

      {/* === 核心区域2：回答列表 (列表流) === */}
      <div className="flex justify-between px-4 pb-2 text-sm text-gray-500">
          <span>{question.answerCount} 个回答</span>
          <span className="flex items-center gap-1">默认排序 <ChevronDown className="w-3 h-3"/></span>
      </div>

      <div className="flex flex-col gap-2">
          {answers.map(answer => (
              // 点击整个卡片，跳转到具体的“回答详情页”
              <Link 
                href={`/forum/${answer.id}?fromQuestion=${question.id}`} 
                key={answer.id}
                className="bg-white p-4 shadow-sm active:bg-gray-50 transition-colors block"
              >
                  {/* 作者栏 */}
                  <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
                          <User className="w-4 h-4 text-gray-400" />
                      </div>
                      <span className="text-sm font-bold text-gray-900">{answer.author}</span>
                      {answer.bio && <span className="text-xs text-gray-400 truncate max-w-[150px]">{answer.bio}</span>}
                  </div>

                  {/* 核心：内容预览 (被截断) */}
                  {/* line-clamp-3 是 Tailwind 类，限制只显示3行，超出显示省略号 */}
                  <div className="text-[15px] text-gray-800 leading-relaxed line-clamp-3 mb-3">
                      {answer.preview}
                  </div>
                  
                  {/* 底部数据栏 */}
                  <div className="flex items-center gap-4 text-gray-400 text-sm">
                      <span className="text-blue-600 font-medium">{answer.voteCount} 赞同</span>
                      <span className="flex items-center gap-1">
                          <MessageCircle className="w-4 h-4" /> {answer.commentCount}
                      </span>
                      <span className="text-xs mt-0.5">2小时前</span>
                  </div>
              </Link>
          ))}
      </div>
      
    </div>
  );
}