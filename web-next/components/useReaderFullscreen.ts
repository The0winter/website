'use client';

import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {exitReaderFullscreen, readerFullscreenActive, readerFullscreenPending, readerFullscreenPreferenceKey, readerFullscreenPreferred, readerFullscreenSupported, requestReaderFullscreen, retainReaderFullscreen, serverFullscreenSnapshot, subscribeReaderFullscreen, withReaderFullscreenCover} from '@/lib/reader-fullscreen';
import {useStoredState} from '@/lib/useStoredState';

let hintSeen = false;
export function useReaderFullscreen(onEntered: () => void, entryPending: boolean) {
  const mounted = useRef(false);
  const supported = useSyncExternalStore(subscribeReaderFullscreen, readerFullscreenSupported, serverFullscreenSnapshot);
  const active = useSyncExternalStore(subscribeReaderFullscreen, readerFullscreenActive, serverFullscreenSnapshot);
  const entering = useSyncExternalStore(subscribeReaderFullscreen, readerFullscreenPending, serverFullscreenSnapshot);
  const [toggling, setToggling] = useState(false);
  const pending = entering || toggling;
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useStoredState(readerFullscreenPreferenceKey, true);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (!active || entryPending || hintSeen) return;
    try {if (localStorage.getItem('reader_fullscreenHintSeen') === 'true') return;} catch {}
    const frame = requestAnimationFrame(() => {
      hintSeen = true;
      try {localStorage.setItem('reader_fullscreenHintSeen', 'true');} catch {}
      setHint(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, entryPending]);
  useEffect(() => {
    if (!hint) return;
    const timeout = window.setTimeout(() => setHint(false), 5000);
    return () => clearTimeout(timeout);
  }, [hint]);

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
      if (readerFullscreenPreferred() && navigator.userActivation?.isActive) void withReaderFullscreenCover(requestReaderFullscreen).catch(() => {});
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

  const change = async (next: boolean, closeOnEntry = false) => {
    if (pending) return;
    setEnabled(next);
    setError('');
    if (next === readerFullscreenActive()) return;
    if (next && !readerFullscreenSupported()) return;
    setToggling(true);
    try {
      if (!next) {
        await withReaderFullscreenCover(exitReaderFullscreen);
      } else {
        await withReaderFullscreenCover(requestReaderFullscreen);
        if (closeOnEntry && mounted.current && readerFullscreenActive()) onEntered();
      }
    } catch {
      if (mounted.current) setError('未能切换全屏，请在设置中重试。');
    } finally {
      if (mounted.current) setToggling(false);
    }
  };

  return {supported, active, pending, error, enabled, hint: hint && active, change, toggle: () => change(!readerFullscreenActive(), true), clearError: () => setError('')};
}
