'use client';

import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {exitReaderFullscreen, readerFullscreenActive, readerFullscreenPending, readerFullscreenSupported, requestReaderFullscreen, retainReaderFullscreen, serverFullscreenSnapshot, subscribeReaderFullscreen, withReaderFullscreenCover} from '@/lib/reader-fullscreen';

export function useReaderFullscreen(onEntered: () => void) {
  const mounted = useRef(false);
  const supported = useSyncExternalStore(subscribeReaderFullscreen, readerFullscreenSupported, serverFullscreenSnapshot);
  const active = useSyncExternalStore(subscribeReaderFullscreen, readerFullscreenActive, serverFullscreenSnapshot);
  const entering = useSyncExternalStore(subscribeReaderFullscreen, readerFullscreenPending, serverFullscreenSnapshot);
  const [toggling, setToggling] = useState(false);
  const pending = entering || toggling;
  const [error, setError] = useState('');

  useEffect(() => {
    mounted.current = true;
    const release = retainReaderFullscreen();
    // A reload/direct URL has no user activation. Use the first normal reading
    // tap, without swallowing it or reopening fullscreen after an explicit exit.
    const stop = () => {
      document.removeEventListener('click', firstTap, true);
      document.removeEventListener('fullscreenchange', stop);
    };
    const firstTap = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!event.isTrusted || !target?.closest('.reader-page-window') || target.closest('button,a,input,textarea,[role=dialog],[role=menu]')) return;
      stop();
      if (navigator.userActivation?.isActive) void withReaderFullscreenCover(requestReaderFullscreen).catch(() => {});
    };
    if (matchMedia('(max-width: 1023px)').matches && readerFullscreenSupported() && !readerFullscreenActive()) {
      document.addEventListener('click', firstTap, true);
      document.addEventListener('fullscreenchange', stop);
    }
    return () => {
      mounted.current = false;
      stop();
      release();
    };
  }, []);

  const toggle = async () => {
    if (pending) return;
    setError('');
    setToggling(true);
    try {
      if (readerFullscreenActive()) {
        await withReaderFullscreenCover(exitReaderFullscreen);
      } else {
        await withReaderFullscreenCover(requestReaderFullscreen);
        if (mounted.current && readerFullscreenActive()) onEntered();
      }
    } catch {
      if (mounted.current) setError('未能切换全屏，请再点一次全屏按钮。');
    } finally {
      if (mounted.current) setToggling(false);
    }
  };

  return {supported, active, pending, error, toggle, clearError: () => setError('')};
}
