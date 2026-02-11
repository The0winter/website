'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  MessageSquare, ThumbsUp, ThumbsDown, MessageCircle, Share2, 
  MoreHorizontal, Plus, Star, Flag, ChevronUp, ChevronDown 
} from 'lucide-react';

export default function PostDetailPage() {
  const params = useParams();
  const router = useRouter();
  // 在真实项目中，这里应该用 useEffect 根据 params.postId 去后端 fetch 数据
  const postId = params.postId;

  // --- 模拟数据：问题详情 ---
  const question = {
    title: "欧洲为什么能突破内卷？",
    description: "我看很多人说是因为地理大发现，也有人说是科技革命。但是本质上，为什么他们的社会形态允许这种突破，而我们似乎陷入了某种循环？希望能从社会学和经济学角度分析。",
    tags: ["社会学", "经济发展", "欧洲历史"],
    viewCount: 34230,
    followCount: 120,
    commentCount: 45,
  };

  // --- 模拟数据：回答列表 ---
  const answers = [
    {
      id: 101,
      author: {
        name: "Steven汤圆",
        bio: "社会学博士在读，观察者",
        avatar: "" // 只要空着就会显示默认颜色
      },
      content: `
        <p class="mb-4">因为欧美认真看透了财富的本质、人的意义。</p>
        <p class="mb-4">中国为什么这么内卷，本质上仍然是对财富没有清晰的认知，以及作为人的意义根本不关注。揪其根源，是我们太过于这种“单一评价体系”。</p>
        <p class="mb-4">在欧洲，一个修水管的工人，他的社会地位并不比一个大学教授低多少，他的收入甚至可能更高。当职业没有贵贱之分，当成功不由金钱唯一衡量时，内卷的土壤就不存在了。</p>
        <div class="bg-gray-100 p-4 rounded text-gray-600 text-sm mb-4">
           此处省略 2000 字深度解析...
        </div>
      `,
      votes: 2336,
      comments: 450,
      time: "发布于 昨天 14:20"
    },
    {
      id: 102,
      author: {
        name: "历史的尘埃",
        bio: "专注于欧洲中世纪史",
        avatar: ""
      },
      content: "其实这个问题要追溯到黑死病时期...",
      votes: 89,
      comments: 12,
      time: "发布于 2小时前"
    }
  ];

  return (
    <div className="min-h-screen bg-[#f6f6f6] pb-20">
      
      {/* 1. 顶部导航 (简易版，为了返回方便) */}
      <div className="bg-white shadow-sm sticky top-0 z-30 border-b border-gray-200">
        <div className="max-w-[1000px] mx-auto px-4 h-14 flex items-center justify-between">
           <button onClick={() => router.back()} className="text-gray-500 hover:text-blue-600 flex items-center gap-1 text-sm font-bold">
              ← 返回列表
           </button>
           <span className="font-bold text-blue-600 text-lg">Novel Forum</span>
        </div>
      </div>

      {/* 2. 问题头部区域 (知乎风格：白色背景，包含标题、描述、操作栏) */}
      <div className="bg-white shadow-sm mb-3 border-b border-gray-200">
          <div className="max-w-[1000px] mx-auto px-4 py-6 flex gap-8">
              <div className="flex-1">
                  {/* 标签 */}
                  <div className="flex gap-2 mb-3">
                      {question.tags.map(tag => (
                          <span key={tag} className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-medium hover:bg-blue-100 cursor-pointer transition-colors">
                              {tag}
                          </span>
                      ))}
                  </div>
                  
                  {/* 标题 */}
                  <h1 className="text-2xl font-bold text-gray-900 mb-4 leading-snug">
                      {question.title}
                  </h1>

                  {/* 描述 */}
                  <p className="text-gray-800 text-[15px] leading-relaxed mb-6">
                      {question.description}
                  </p>

                  {/* 按钮组 */}
                  <div className="flex items-center gap-3">
                      <button className="bg-blue-600 text-white px-5 py-2 rounded-[4px] text-sm font-medium hover:bg-blue-700 transition-colors">
                          写回答
                      </button>
                      <button className="border border-blue-600 text-blue-600 px-5 py-2 rounded-[4px] text-sm font-medium hover:bg-blue-50 transition-colors">
                          邀请回答
                      </button>
                      
                      <div className="flex items-center gap-6 ml-4">
                          <button className="flex items-center gap-1.5 text-gray-500 text-sm hover:text-gray-700">
                              <Plus className="w-4 h-4" />
                              关注问题 {question.followCount}
                          </button>
                          <button className="flex items-center gap-1.5 text-gray-500 text-sm hover:text-gray-700">
                              <MessageCircle className="w-4 h-4" />
                              {question.commentCount} 条评论
                          </button>
                      </div>
                  </div>
              </div>

              {/* 右侧数据统计 (桌面端显示) */}
              <div className="hidden md:flex w-[296px] flex-shrink-0 flex-col gap-4 border-l border-gray-100 pl-6">
                   <div className="flex justify-between items-center">
                       <div>
                           <div className="text-gray-500 text-sm">关注者</div>
                           <div className="font-bold text-lg">{question.followCount}</div>
                       </div>
                       <div>
                           <div className="text-gray-500 text-sm">被浏览</div>
                           <div className="font-bold text-lg">{question.viewCount}</div>
                       </div>
                   </div>
              </div>
          </div>
      </div>

      {/* 3. 主体布局：左侧回答列表，右侧侧边栏 */}
      <div className="max-w-[1000px] mx-auto px-4 grid grid-cols-1 md:grid-cols-[1fr_296px] gap-3">
          
          {/* === 左侧：回答列表 === */}
          <div className="flex flex-col gap-3">
              {/* 顶部筛选条 */}
              <div className="bg-white p-3 rounded-sm shadow-sm flex justify-between items-center border-b border-gray-100">
                  <span className="font-bold text-sm text-gray-800">
                      {answers.length} 个回答
                  </span>
                  <div className="text-sm text-gray-500 flex items-center gap-1 cursor-pointer">
                      默认排序 <ChevronDown className="w-4 h-4" />
                  </div>
              </div>

              {/* 回答卡片 */}
              {answers.map(answer => (
                  <div key={answer.id} className="bg-white p-5 rounded-sm shadow-sm">
                      {/* 作者信息 */}
                      <div className="flex items-center gap-3 mb-3">
                          <div className="w-9 h-9 bg-gray-200 rounded text-gray-500 flex items-center justify-center text-xs font-bold overflow-hidden">
                             {answer.author.avatar ? <img src={answer.author.avatar} /> : "User"}
                          </div>
                          <div>
                              <div className="font-bold text-sm text-gray-900">{answer.author.name}</div>
                              <div className="text-xs text-gray-500">{answer.author.bio}</div>
                          </div>
                      </div>

                      {/* 赞同数 (知乎现在的设计，赞同放在内容左侧或底部，这里采用经典底部栏) */}
                      <div className="text-gray-800 leading-7 text-[15px] mb-4" 
                           dangerouslySetInnerHTML={{ __html: answer.content }}>
                      </div>
                      
                      <div className="text-sm text-gray-400 mb-4">
                          {answer.time}
                      </div>

                      {/* 底部粘性操作栏 (知乎风格) */}
                      <div className="flex items-center gap-4 sticky bottom-0 bg-white pt-2 pb-1">
                          <button className="flex items-center bg-blue-50 text-blue-600 px-3 py-1.5 rounded-[4px] text-sm font-medium hover:bg-blue-100 transition-colors gap-1">
                              <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[6px] border-b-blue-600 mb-0.5"></div>
                              赞同 {answer.votes}
                          </button>
                          <button className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-[4px] hover:bg-blue-100 transition-colors">
                              <ChevronDown className="w-4 h-4" />
                          </button>

                          <button className="flex items-center gap-1 text-gray-500 hover:text-gray-600 text-sm ml-2">
                              <MessageCircle className="w-5 h-5 text-gray-400" />
                              {answer.comments} 条评论
                          </button>
                          
                          <button className="flex items-center gap-1 text-gray-500 hover:text-gray-600 text-sm">
                              <Share2 className="w-4 h-4" />
                              分享
                          </button>
                          
                          <button className="flex items-center gap-1 text-gray-500 hover:text-gray-600 text-sm">
                              <Star className="w-4 h-4" />
                              收藏
                          </button>
                      </div>
                  </div>
              ))}
          </div>

          {/* === 右侧：侧边栏 === */}
          <div className="hidden md:flex flex-col gap-3">
              {/* 作者榜单/相关推荐 */}
              <div className="bg-white rounded-sm shadow-sm p-4">
                  <h3 className="font-semibold text-gray-700 text-sm mb-4 border-l-4 border-blue-600 pl-2">
                      相关问题
                  </h3>
                  <ul className="flex flex-col gap-3">
                      {[
                          "内卷的本质是什么？",
                          "如何看待2026年的经济形势？",
                          "普通人如何应对由于AI带来的失业潮？"
                      ].map((q, i) => (
                          <li key={i}>
                              <a href="#" className="text-sm text-gray-700 hover:text-blue-600 hover:underline leading-snug block">
                                  {q}
                              </a>
                              <span className="text-xs text-gray-400 mt-1 block">{100 + i * 20} 个回答</span>
                          </li>
                      ))}
                  </ul>
              </div>

              {/* 广告/Banner占位 */}
              <div className="bg-white rounded-sm shadow-sm p-4">
                 <div className="w-full h-40 bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                     广告位 / 推荐书籍
                 </div>
              </div>
          </div>

      </div>
    </div>
  );
}