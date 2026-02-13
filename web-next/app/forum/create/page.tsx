'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Hash, HelpCircle, Loader2, PenTool } from 'lucide-react';
import { forumApi } from '@/lib/api';

const theme = {
  bg: 'bg-[#f5f6f7]',
  card: 'bg-white',
  textMain: 'text-[#1f2329]',
  textSub: 'text-[#646a73]',
  border: 'border-[#e6e8eb]',
  primaryBtn: 'bg-[#111827] text-white hover:bg-black'
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
    return [...new Set(tags.split(/[,\s，、]+/).map((tag) => tag.trim()).filter(Boolean))].slice(0, TAG_MAX);
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
      alert('提问标题需以问号结尾（? 或 ？）');
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
    <div className={`min-h-screen ${theme.bg} pb-24 relative font-sans`}>
      <div className="bg-white/92 backdrop-blur-md border-b border-[#e6e8eb] sticky top-0 z-30">
        <div className="max-w-[860px] mx-auto px-4 h-14 md:h-16 flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="text-[#646a73] hover:text-[#111827] flex items-center gap-1.5 font-medium text-sm transition-colors"
          >
            <ArrowLeft className="w-5 h-5" /> 取消
          </button>

          <span className="font-bold text-[#1f2329] text-[15px] md:text-base tracking-tight">
            {type === 'question' ? '发布提问' : '发布文章'}
          </span>

          <button
            onClick={handlePreSubmit}
            disabled={isSubmitting}
            className={`${theme.primaryBtn} px-4 md:px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
          >
            发布
          </button>
        </div>
      </div>

      <div className="max-w-[860px] mx-auto mt-4 md:mt-8 px-4">
        <div className="flex bg-[#edf0f3] p-1 rounded-xl mb-4 md:mb-6 w-full md:w-fit">
          <button
            onClick={() => setType('question')}
            className={`flex-1 md:flex-none px-4 md:px-6 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${type === 'question' ? 'bg-white text-[#111827] shadow-sm' : 'text-[#6b7280] hover:text-[#1f2329]'}`}
          >
            <HelpCircle className="w-4 h-4" /> 提问
          </button>
          <button
            onClick={() => setType('article')}
            className={`flex-1 md:flex-none px-4 md:px-6 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${type === 'article' ? 'bg-white text-[#111827] shadow-sm' : 'text-[#6b7280] hover:text-[#1f2329]'}`}
          >
            <PenTool className="w-4 h-4" /> 文章
          </button>
        </div>

        <div className={`${theme.card} p-4 md:p-8 rounded-2xl shadow-sm border ${theme.border}`}>
          <div className="mb-5 md:mb-6">
            <input
              type="text"
              placeholder={type === 'question' ? '请输入问题标题（建议以问号结尾）' : '请输入文章标题'}
              className="w-full text-[28px] md:text-[40px] font-bold text-[#1f2329] placeholder:text-[#c0c4cc] border-none outline-none bg-transparent leading-tight"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={TITLE_MAX + 10}
              autoFocus
            />
            <div className="mt-2 text-xs text-[#98a2b3] text-right">
              {title.trim().length}/{TITLE_MAX}
            </div>
          </div>

          <textarea
            className="w-full h-[360px] md:h-[420px] resize-none text-base md:text-lg text-[#2d3748] placeholder:text-[#c0c4cc] border-none outline-none bg-transparent leading-8"
            placeholder={type === 'question' ? '补充问题背景、限制条件、你已尝试过的方法...' : '开始写正文内容...'}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={CONTENT_MAX + 1000}
          />
          <div className="mt-2 text-xs text-[#98a2b3] text-right">
            {content.trim().length}/{CONTENT_MAX}
          </div>

          <div className="mt-6 pt-5 border-t border-[#f0f2f4] flex items-center gap-3">
            <Hash className="w-4 h-4 text-[#98a2b3]" />
            <input
              type="text"
              placeholder="添加标签（空格或逗号分隔）"
              className="flex-1 bg-transparent border-none outline-none text-sm text-[#1f2329] placeholder:text-[#98a2b3]"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <span className="text-xs text-[#98a2b3]">{parsedTags.length}/{TAG_MAX}</span>
          </div>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm animate-in fade-in duration-200 px-4">
          <div className="bg-white w-full max-w-[360px] rounded-2xl p-6 shadow-xl border border-[#eef1f4]">
            <div className="flex flex-col items-center text-center">
              <h3 className="text-lg font-bold text-[#1f2329] mb-2">确认发布？</h3>
              <p className="text-sm text-[#646a73] mb-6">发布后将会对其他用户可见。</p>

              <div className="flex w-full gap-3">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 py-2.5 rounded-lg border border-[#dfe3e8] text-[#5f6772] font-medium text-sm hover:bg-[#f7f8fa] transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmSubmit}
                  className="flex-1 py-2.5 rounded-lg bg-[#111827] text-white font-semibold text-sm hover:bg-black transition-colors"
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
                <div className="w-16 h-16 bg-[#111827] rounded-full flex items-center justify-center mb-4 animate-bounce">
                  <CheckCircle2 className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-xl font-bold text-[#1f2329]">发布成功</h3>
              </>
            ) : (
              <>
                <Loader2 className="w-10 h-10 text-[#111827] animate-spin mb-4" />
                <p className="text-[#646a73] font-medium text-sm">正在提交...</p>
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
