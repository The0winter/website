'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Hash, HelpCircle, Loader2, PenTool } from 'lucide-react';
import { forumApi } from '@/lib/api';

const theme = {
  bg: 'bg-[#f8f9fa]',
  card: 'bg-white',
  textMain: 'text-gray-900',
  textSub: 'text-gray-500',
  border: 'border-gray-200',
  primaryBtn: 'bg-gray-900 text-white hover:bg-black',
};

const TITLE_MAX = 120;
const CONTENT_MAX = 30000;
const TAG_MAX = 8;

function CreatePostContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultType = searchParams.get('type') === 'article' ? 'article' : 'question';

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<'question' | 'article'>(defaultType);
  const [tags, setTags] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const parsedTags = useMemo(() => {
    return [...new Set(tags.split(/[,\s，]+/).map(tag => tag.trim()).filter(Boolean))].slice(0, TAG_MAX);
  }, [tags]);

  const validateBeforeSubmit = () => {
    const finalTitle = title.trim();
    const finalContent = content.trim();

    if (!finalTitle || !finalContent) {
      alert('标题和内容不能为空');
      return false;
    }

    if (finalTitle.length > TITLE_MAX) {
      alert(`标题不能超过 ${TITLE_MAX} 字`);
      return false;
    }

    if (finalContent.length > CONTENT_MAX) {
      alert(`内容不能超过 ${CONTENT_MAX} 字`);
      return false;
    }

    if (type === 'question' && !/[?？]\s*$/.test(finalTitle)) {
      alert('提问标题必须以问号结尾（? 或 ？）');
      return false;
    }

    return true;
  };

  const handlePreSubmit = () => {
    if (!validateBeforeSubmit()) return;
    setShowConfirm(true);
  };

  const handleConfirmSubmit = async () => {
    setShowConfirm(false);
    setIsSubmitting(true);

    try {
      await forumApi.create({
        title: title.trim(),
        content: content.trim().replace(/\n/g, '<br/>'),
        type,
        tags: parsedTags
      });

      setShowSuccess(true);
      setTimeout(() => router.push('/forum'), 1200);
    } catch (error: any) {
      alert(`发布失败：${error.message || '请稍后重试'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`min-h-screen ${theme.bg} pb-20 relative font-sans`}>
      <div className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-[800px] mx-auto px-4 h-16 flex items-center justify-between">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-900 flex items-center gap-2 font-medium text-sm transition-colors">
            <ArrowLeft className="w-5 h-5" /> 取消
          </button>

          <span className="font-bold text-gray-900 text-base">
            {type === 'question' ? '发布提问' : '发布文章'}
          </span>

          <button
            onClick={handlePreSubmit}
            disabled={isSubmitting}
            className={`${theme.primaryBtn} px-6 py-2 rounded-lg text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm`}
          >
            发布
          </button>
        </div>
      </div>

      <div className="max-w-[800px] mx-auto mt-8 px-4">
        <div className="flex bg-gray-100 p-1 rounded-xl mb-8 w-fit mx-auto">
          <button
            onClick={() => setType('question')}
            className={`px-6 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${type === 'question' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
          >
            <HelpCircle className="w-4 h-4" /> 提问
          </button>
          <button
            onClick={() => setType('article')}
            className={`px-6 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${type === 'article' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
          >
            <PenTool className="w-4 h-4" /> 文章
          </button>
        </div>

        <div className={`${theme.card} p-8 md:p-12 rounded-2xl shadow-sm border border-transparent hover:border-gray-200 transition-colors`}>
          <div className="mb-6">
            <input
              type="text"
              placeholder={type === 'question' ? '请输入问题标题（结尾必须是问号）' : '请输入文章标题'}
              className="w-full text-3xl md:text-4xl font-bold text-gray-900 placeholder-gray-300 border-none outline-none bg-transparent leading-tight"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={TITLE_MAX + 10}
              autoFocus
            />
            <div className="mt-2 text-xs text-gray-400 text-right">
              {title.trim().length}/{TITLE_MAX}
            </div>
          </div>

          <textarea
            className="w-full h-[400px] resize-none text-lg text-gray-800 placeholder-gray-300 border-none outline-none bg-transparent leading-relaxed"
            placeholder={type === 'question' ? '描述你的问题背景、已尝试的方法和关键条件...' : '开始写你的文章内容...'}
            value={content}
            onChange={e => setContent(e.target.value)}
            maxLength={CONTENT_MAX + 1000}
          ></textarea>
          <div className="mt-2 text-xs text-gray-400 text-right">
            {content.trim().length}/{CONTENT_MAX}
          </div>

          <div className="mt-8 pt-6 border-t border-gray-50 flex items-center gap-3">
            <Hash className="w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="添加话题标签（逗号或空格分隔）"
              className="flex-1 bg-transparent border-none outline-none text-sm text-gray-900 placeholder-gray-400"
              value={tags}
              onChange={e => setTags(e.target.value)}
            />
            <span className="text-xs text-gray-400">{parsedTags.length}/{TAG_MAX}</span>
          </div>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/20 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-[340px] rounded-2xl p-6 shadow-xl border border-gray-100">
            <div className="flex flex-col items-center text-center">
              <h3 className="text-lg font-bold text-gray-900 mb-2">确认发布？</h3>
              <p className="text-sm text-gray-500 mb-6">发布后将对其他用户可见。</p>

              <div className="flex w-full gap-3">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 py-2.5 rounded-lg border border-gray-200 text-gray-600 font-medium text-sm hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmSubmit}
                  className="flex-1 py-2.5 rounded-lg bg-gray-900 text-white font-bold text-sm hover:bg-black transition-colors"
                >
                  确认发布
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {(isSubmitting || showSuccess) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white/90 backdrop-blur-sm">
          <div className="flex flex-col items-center">
            {showSuccess ? (
              <>
                <div className="w-16 h-16 bg-gray-900 rounded-full flex items-center justify-center mb-4 animate-bounce">
                  <CheckCircle2 className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-xl font-bold text-gray-900">发布成功</h3>
              </>
            ) : (
              <>
                <Loader2 className="w-10 h-10 text-gray-900 animate-spin mb-4" />
                <p className="text-gray-500 font-medium text-sm">正在提交...</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CreatePostPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-400">加载中...</div>}>
      <CreatePostContent />
    </Suspense>
  );
}
