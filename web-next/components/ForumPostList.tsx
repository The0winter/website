'use client';
import Link from 'next/link';
import {ThumbsUp, MessageCircle} from 'lucide-react';
import type {ForumPost} from '@/lib/api';

const currentTheme = {
  card: 'md:bg-[var(--home-surface)]',
  textMain: 'text-[var(--home-text)]',
  textSub: 'text-[var(--home-muted)]',
  border: 'border-[var(--home-border)]',
};
const fontSize = 16;

function formatCount(value: number) {
  if (!value) return '0';
  if (value >= 10000) return `${(value / 10000).toFixed(1)}w`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export default function ForumPostList({posts: tabPosts = [], loading: isTabLoading}: {posts?: ForumPost[]; loading: boolean}) {

    return (
      <div className={`overflow-hidden md:rounded-2xl md:border ${currentTheme.border} ${currentTheme.card} w-full min-h-[50vh]`}>
        {isTabLoading && (
          <div className={`p-10 text-center text-sm ${currentTheme.textSub}`}>加载中...</div>
        )}

        {!isTabLoading && tabPosts.length === 0 && (
          <div className={`p-10 text-center text-sm ${currentTheme.textSub}`}>暂无内容</div>
        )}

        {!isTabLoading && tabPosts.map((post, index) => {
          const realId = post.id;
          if (!realId) return null;

          const topReply = post.topReply || null;
          const answerLink = topReply?.id ? `/forum/${topReply.id}?fromQuestion=${realId}` : `/forum/question/${realId}`;
          const answerVotes = topReply?.votes ?? post.votes ?? 0;
          const answerComments = topReply?.comments ?? post.comments ?? 0;
          const authorName = topReply?.author?.name || '暂无回答';
          const excerpt = topReply?.content || '这个问题还没有回答，点击查看并参与讨论。';

          return (
            <article
              key={realId}
              className={`px-4 md:px-6 py-4 md:py-5 ${index < tabPosts.length - 1 ? `border-b ${currentTheme.border}` : ''}`}
            >
              <Link href={`/forum/question/${realId}`} className="block">
                <h2
                  className={`font-bold leading-[1.42] tracking-tight ${currentTheme.textMain} hover:text-[var(--home-accent)] transition-colors`}
                  style={{ fontSize: `${fontSize + 4}px` }}
                >
                  {post.title}
                </h2>
              </Link>

              <div className="mt-3 flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full overflow-hidden flex items-center justify-center bg-[var(--home-soft)]`}>
                  {topReply?.author?.avatar ? (
                    <img src={topReply.author.avatar} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className={`text-[11px] font-semibold ${currentTheme.textSub}`}>
                      {authorName.slice(0, 1)}
                    </span>
                  )}
                </div>
                <span className={`text-sm font-medium ${currentTheme.textMain}`}>{authorName}</span>
              </div>

              <Link href={answerLink} className="block">
                <p
                  className={`mt-2 leading-[1.65] line-clamp-2 md:line-clamp-3 ${currentTheme.textSub} hover:text-[var(--home-text)] transition-colors`}
                  style={{ fontSize: `${fontSize}px` }}
                >
                  {excerpt}
                </p>
              </Link>

              <div className={`mt-3 flex items-center gap-5 text-[13px] ${currentTheme.textSub}`}>
                <span className="inline-flex items-center gap-1.5">
                  <ThumbsUp className="w-3.5 h-3.5" />
                  {formatCount(answerVotes)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MessageCircle className="w-3.5 h-3.5" />
                  {formatCount(answerComments)}
                </span>
                <span className="ml-auto text-xs">{topReply ? '查看回答' : '去回答'}</span>
              </div>
            </article>
          );
        })}
      </div>
    );
  }
