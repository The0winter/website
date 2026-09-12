'use client';

import {useEffect} from 'react';
import {usePathname} from 'next/navigation';
import {useAuth} from '@/contexts/AuthContext';
import {recordBookVisit} from '@/lib/book-visit';
import {currentChapterEntry} from '@/lib/chapter-entry';

/** Visible book pages record visits; explicit shelf entries can start the same write earlier. */
export default function RecordBookVisit({bookId, chapterId}: {bookId: string; chapterId?: string}) {
  const {user} = useAuth();
  const pathname = usePathname();
  const userId = user?.id;
  useEffect(() => {
    if (!userId || pathname !== `/book/${bookId}${chapterId ? `/${chapterId}` : ''}`) return;
    const record = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', record);
      void recordBookVisit({userId, bookId, chapterId}, currentChapterEntry()?.token).catch(() => {});
    };
    // Defer one task so discarded renders/Strict Mode do not create extra writes.
    const timer = window.setTimeout(record, 0);
    document.addEventListener('visibilitychange', record);
    return () => {window.clearTimeout(timer); document.removeEventListener('visibilitychange', record);};
  }, [bookId, chapterId, userId, pathname]);
  return null;
}
