'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, HelpCircle, PenTool, Loader2 } from 'lucide-react';
import { forumApi } from '@/lib/api';

export default function CreatePostPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 获取 URL 参数 ?type=article 还是 question
  const defaultType = searchParams.get('type') === 'article' ? 'article' : 'question';

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<'question' | 'article'>(defaultType);
  const [tags, setTags] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 提交逻辑
  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) {
      alert('标题和内容不能为空');
      return;
    }

    try {
      setIsSubmitting(true);
      // 分割标签字符串，如 "社会学 经济" -> ["社会学", "经济"]
      const tagArray = tags.split(/[,，\s]+/).filter(Boolean);

      // 🔥 调用后端接口
      await forumApi.create({
        title,
        content: content.replace(/\n/g, '<br/>'), // 简单把换行转为 HTML
        type,
        tags: tagArray
      });

      alert('发布成功！');
      router.push('/forum'); // 跳回论坛首页
    } catch (error: any) {
      alert('发布失败: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* 顶部导航 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-[800px] mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-900 flex items-center gap-1 font-bold">
            <ArrowLeft className="w-5 h-5" /> 取消
          </button>
          <span className="font-bold text-gray-900">
            {type === 'question' ? '提问题' : '写文章'}
          </span>
          <button 
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="text-blue-600 font-bold hover:bg-blue-50 px-3 py-1 rounded disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : '发布'}
          </button>
        </div>
      </div>

      {/* 编辑主体 */}
      <div className="max-w-[800px] mx-auto mt-6 px-4">
        
        {/* 类型切换 */}
        <div className="flex gap-4 mb-6">
           <button 
             onClick={() => setType('question')}
             className={`flex items-center gap-2 px-6 py-3 rounded-lg border font-bold transition-all ${type === 'question' ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}
           >
              <HelpCircle className="w-5 h-5" /> 提问
           </button>
           <button 
             onClick={() => setType('article')}
             className={`flex items-center gap-2 px-6 py-3 rounded-lg border font-bold transition-all ${type === 'article' ? 'border-orange-500 bg-orange-50 text-orange-600' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}
           >
              <PenTool className="w-5 h-5" /> 文章
           </button>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col gap-4">
           {/* 标题输入 */}
           <input 
             type="text" 
             placeholder={type === 'question' ? "请输入问题标题，以问号结尾..." : "请输入文章标题..."}
             className="w-full text-2xl font-bold placeholder-gray-300 border-none outline-none ring-0 p-0"
             value={title}
             onChange={e => setTitle(e.target.value)}
           />
           
           <hr className="border-gray-100" />

           {/* 内容输入 (简单 Textarea，实际项目可用富文本编辑器) */}
           <textarea 
             className="w-full h-[400px] resize-none text-lg text-gray-700 placeholder-gray-300 border-none outline-none ring-0 p-0"
             placeholder={type === 'question' ? "详细描述你的问题背景、条件等..." : "开始你的创作..."}
             value={content}
             onChange={e => setContent(e.target.value)}
           ></textarea>
           
           <hr className="border-gray-100" />

           {/* 标签输入 */}
           <div className="flex items-center gap-3">
              <span className="text-gray-400 text-sm font-bold"># 话题标签</span>
              <input 
                type="text" 
                placeholder="例如：社会学 经济 (空格分隔)"
                className="flex-1 bg-gray-50 border-none rounded-md px-3 py-2 text-sm focus:bg-white focus:ring-1 focus:ring-blue-500 transition-all"
                value={tags}
                onChange={e => setTags(e.target.value)}
              />
           </div>
        </div>
      </div>
    </div>
  );
}