'use client';

import {useEffect} from 'react';
import {usePathname} from 'next/navigation';
import {useAuth} from '@/contexts/AuthContext';
import {safeFetch} from '@/lib/request';

/** Only mounted, visible book pages record visits; prefetches never write history. */
export default function RecordBookVisit({bookId, chapterId}: {bookId: string; chapterId?: string}) {
  const {user} = useAuth();
  const pathname = usePathname();
  const userId = user?.id;
  useEffect(() => {
    if (!userId || pathname !== `/book/${bookId}${chapterId ? `/${chapterId}` : ''}`) return;
    const record = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', record);
      void safeFetch(`/api/users/${userId}/history`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({bookId, chapterId})}).catch(() => {});
    };
    // Defer one task so discarded renders/Strict Mode do not create extra writes.
    const timer = window.setTimeout(record, 0);
    document.addEventListener('visibilitychange', record);
    return () => {window.clearTimeout(timer); document.removeEventListener('visibilitychange', record);};
  }, [bookId, chapterId, userId, pathname]);
  return null;
}
