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
        
{/* 🔥 修改 1: 外层透明 */}
    <div className="sticky top-0 z-30">
      {/* 🔥 修改 2: 内层白色、阴影、圆角 */}
      <div className="max-w-[1000px] mx-auto bg-white shadow-sm border-b border-x border-gray-200 px-4 h-14 flex items-center justify-between rounded-b-lg">
            <button onClick={() => router.back()} className="text-gray-500 hover:text-blue-600 flex items-center gap-1 text-sm font-bold">
                ← 返回列表
            </button>
            {/* 这里的 Logo 或标题可以根据需要显示或隐藏 */}
            <span className="font-bold text-blue-600 text-lg hidden md:block">Novel Forum</span>
        </div>
        </div>

        {/* 问题头部区域：虽然背景是满屏白，但内容在中间 */}
        <div className="bg-white shadow-sm mb-3 border-b border-gray-200">
            <div className="max-w-[1000px] mx-auto px-4 py-6">
                {/* ... 这里的代码保持不变 ... */}
                <Link 
                href={`/forum/question/${fromQuestionId || '1'}`} 
                className="group block mb-4"
                >
                {/* ... 内容 ... */}
                <h1 className="text-2xl font-bold text-gray-900 leading-snug group-hover:text-blue-600 transition-colors">
                        {question.title}
                </h1>
                </Link>
                
                {/* ... 描述和按钮组 ... */}
            </div>
        </div>

        {/* 回答详情主体：双栏布局，宽度限制 1000px */}
        <div className="max-w-[1000px] mx-auto px-4 grid grid-cols-1 md:grid-cols-[1fr_296px] gap-3">
            {/* ... 下面的代码保持不变 ... */}
            <div className="flex flex-col gap-3">
            {/* 回答内容 */}
            </div>
            
            {/* 侧边栏 */}
            <div className="hidden md:block">
                {/* ... */}
            </div>
        </div>
    </div>
    );
}