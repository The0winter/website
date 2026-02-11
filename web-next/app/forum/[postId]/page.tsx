'use client'; // <--- 1. 必须在第一行

import { useState } from 'react';
// 2. 注意这里必须是 next/navigation
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  MessageSquare, Share2, Star, Plus, ChevronDown, MessageCircle 
} from 'lucide-react';

export default function PostDetailPage() {
  // --- 3. Hooks 必须写在组件函数内部的最上方 ---
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams(); // 如果报错，检查是否安装了最新的 Next.js
  
  // 获取 URL 里的来源参数 (?fromQuestion=xxx)
  const fromQuestionId = searchParams.get('fromQuestion');

  // 模拟数据（实际项目中这里会根据 params.postId 请求接口）
  const postId = params.postId;

  const question = {
    id: "1", // 假设这就是 ID 为 1 的问题
    title: "欧洲为什么能突破内卷？",
    description: "我看很多人说是因为地理大发现，也有人说是科技革命...",
    tags: ["社会学", "经济发展"],
    viewCount: 34230,
    followCount: 120,
    commentCount: 45,
  };

  const answers = [
    {
      id: 101,
      author: { name: "Steven汤圆", bio: "社会学博士在读", avatar: "" },
      content: "<p class='mb-4'>因为欧美认真看透了财富的本质...</p>",
      votes: 2336,
      comments: 450,
      time: "昨天 14:20"
    }
    // ... 其他回答
  ];

  return (
    <div className="min-h-screen bg-[#f6f6f6] pb-20">
      
      {/* 顶部导航 */}
      <div className="bg-white shadow-sm sticky top-0 z-30 border-b border-gray-200">
        <div className="max-w-[1000px] mx-auto px-4 h-14 flex items-center justify-between">
           <button onClick={() => router.back()} className="text-gray-500 hover:text-blue-600 flex items-center gap-1 text-sm font-bold">
              ← 返回
           </button>
           <span className="font-bold text-blue-600 text-lg">Novel Forum</span>
        </div>
      </div>

      {/* 问题头部区域 */}
      <div className="bg-white shadow-sm mb-3 border-b border-gray-200">
          <div className="max-w-[1000px] mx-auto px-4 py-6">
              
              {/* 🔥 返回问题页的入口 */}
              <Link 
                 // 如果有来源ID就跳回去，没有就默认跳到 ID=1
                 href={`/forum/question/${fromQuestionId || '1'}`} 
                 className="group block mb-4"
              >
                  <div className="flex gap-2 mb-2">
                      {question.tags.map(tag => (
                          <span key={tag} className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full text-xs">
                              {tag}
                          </span>
                      ))}
                      <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full text-xs group-hover:bg-blue-600 group-hover:text-white transition-colors">
                          查看问题及全部回答 &rarr;
                      </span>
                  </div>
                  
                  <h1 className="text-2xl font-bold text-gray-900 leading-snug group-hover:text-blue-600 transition-colors">
                      {question.title}
                  </h1>
              </Link>
              
              {/* 描述摘要 */}
              <p className="text-gray-800 text-[15px] leading-relaxed mb-6 line-clamp-2">
                  {question.description}
              </p>

              {/* 按钮组 */}
              <div className="flex items-center gap-3">
                  <button className="bg-blue-600 text-white px-5 py-2 rounded-[4px] text-sm font-medium hover:bg-blue-700 transition-colors">
                      写回答
                  </button>
                  <button className="flex items-center gap-1.5 text-gray-500 text-sm hover:text-gray-700 ml-4">
                      <Plus className="w-4 h-4" /> 关注问题
                  </button>
              </div>
          </div>
      </div>

      {/* 回答详情主体 */}
      <div className="max-w-[1000px] mx-auto px-4 grid grid-cols-1 md:grid-cols-[1fr_296px] gap-3">
          <div className="flex flex-col gap-3">
              {answers.map(answer => (
                  <div key={answer.id} className="bg-white p-5 rounded-sm shadow-sm">
                      <div className="flex items-center gap-3 mb-3">
                          <div className="w-9 h-9 bg-gray-200 rounded text-gray-500 flex items-center justify-center text-xs font-bold">
                             User
                          </div>
                          <div>
                              <div className="font-bold text-sm text-gray-900">{answer.author.name}</div>
                              <div className="text-xs text-gray-500">{answer.author.bio}</div>
                          </div>
                      </div>

                      <div className="text-gray-800 leading-7 text-[15px] mb-4" 
                           dangerouslySetInnerHTML={{ __html: answer.content }}>
                      </div>
                      
                      <div className="text-sm text-gray-400 mb-4">{answer.time}</div>

                      {/* 底部操作栏 */}
                      <div className="flex items-center gap-4 sticky bottom-0 bg-white pt-2 pb-1 border-t border-gray-50">
                          <button className="flex items-center bg-blue-50 text-blue-600 px-3 py-1.5 rounded-[4px] text-sm font-medium gap-1">
                              赞同 {answer.votes}
                          </button>
                          <button className="flex items-center gap-1 text-gray-500 text-sm ml-2">
                              <MessageCircle className="w-5 h-5 text-gray-400" />
                              {answer.comments} 条评论
                          </button>
                          <button className="flex items-center gap-1 text-gray-500 text-sm">
                              <Share2 className="w-4 h-4" /> 分享
                          </button>
                      </div>
                  </div>
              ))}
          </div>
          
          {/* 右侧边栏 */}
          <div className="hidden md:block">
              <div className="bg-white p-4 rounded-sm shadow-sm text-center text-gray-400 text-sm">
                  广告位
              </div>
          </div>
      </div>
    </div>
  );
}