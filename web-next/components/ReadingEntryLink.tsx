'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import PrefetchLink from './PrefetchLink';
import { lastReadChapter, serverLastReadChapter, subscribeReadingSession } from '@/lib/reading-session';
import {beginChapterEntry} from '@/lib/chapter-entry';

export default function ReadingEntryLink({ bookId, firstChapterId, className, icon, label = '开始阅读' }: {
  bookId: string; firstChapterId: string; className?: string; icon?: ReactNode; label?: string;
}) {
  const recent = useSyncExternalStore(subscribeReadingSession, () => lastReadChapter(bookId), serverLastReadChapter);
  const href = `/book/${bookId}/${recent ?? firstChapterId}`;
  return <PrefetchLink href={href} className={className} pendingLabel="正在打开章节…" onNavigate={() => beginChapterEntry(href, recent ? '继续阅读' : '开始阅读', 'resume')}>
    {icon}<span>{recent && recent !== firstChapterId ? '继续阅读' : label}</span>
  </PrefetchLink>;
}
