'use client';

import {useEffect} from 'react';
import {usePathname, useRouter} from 'next/navigation';
import {useAuth} from '@/contexts/AuthContext';
import {invalidateLibrary, prefetchLibrary, type LibrarySort} from '@/lib/library-cache';

function savedSort(): LibrarySort {
  try {
    const raw = localStorage.getItem('library-sort');
    let value: unknown = raw;
    try { value = raw ? JSON.parse(raw) : 'combined'; } catch {}
    if (value === 'read' || value === 'updated') return value;
  } catch {}
  return 'combined';
}

export default function LibraryPrefetch() {
  const {user} = useAuth();
  const userId = user?.id;
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!userId) return;
    const warm = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      router.prefetch('/library');
      void prefetchLibrary(userId, savedSort());
    };
    const changed = (event: Event) => {
      if ((event as CustomEvent<{userId: string}>).detail.userId !== userId) return;
      invalidateLibrary(userId);
      warm();
    };
    warm();
    window.addEventListener('library-changed', changed);
    window.addEventListener('online', warm);
    window.addEventListener('focus', warm);
    document.addEventListener('visibilitychange', warm);
    return () => {
      window.removeEventListener('library-changed', changed);
      window.removeEventListener('online', warm);
      window.removeEventListener('focus', warm);
      document.removeEventListener('visibilitychange', warm);
    };
  }, [userId, pathname, router]);
  return null;
}
