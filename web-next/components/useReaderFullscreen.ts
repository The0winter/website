'use client';

import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {exitReaderFullscreen, readerFullscreenActive, readerFullscreenPending, readerFullscreenPreferenceKey, readerFullscreenPreferred, readerFullscreenSupported, requestReaderFullscreen, retainReaderFullscreen, serverFullscreenSnapshot, subscribeReaderFullscreen, withReaderFullscreenCover} from '@/lib/reader-fullscreen';
import {listenFullscreenChange} from '@/lib/browser-fullscreen';
import {useStoredState} from '@/lib/useStoredState';

let hintDismissedForSession = false;
export function useReaderFullscreen(onEntered: () => void, entryPending: boolean) {
  const mounted = useRef(false);
  const supported = useSyncExternalStore(subscribeReaderFullscreen, readerFullscreenSupported, serverFullscreenSnapshot);
  const active = useSyncExternalStore(subscribeReaderFullscreen, readerFullscreenActive, serverFullscreenSnapshot);
  const entering = useSyncExternalStore(subscribeReaderFullscreen, readerFullscreenPending, serverFullscreenSnapshot);
  const [toggling, setToggling] = useState(false);
  const pending = entering || toggling;
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useStoredState(readerFullscreenPreferenceKey, false);
  // The former "seen" flag was written automatically and does not establish
  // acknowledgement. Only this explicit opt-out suppresses future reminders.
  const [hintDismissed, setHintDismissed] = useStoredState('reader_fullscreenHintDismissed', false);
  const [dismissedInSession, setDismissedInSession] = useState(() => hintDismissedForSession);
  const dismissHint = () => {
    hintDismissedForSession = true;
    setDismissedInSession(true);
    setHintDismissed(true);
  };

  useEffect(() => {
    mounted.current = true;
    const release = retainReaderFullscreen();
    // A reload/direct URL has no user activation. Use the first normal reading
    // tap, without swallowing it or reopening fullscreen after an explicit exit.
    let stopChange = () => {};
    const stop = () => {
      document.removeEventListener('click', firstTap, true);
      stopChange();
    };
    const firstTap = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!event.isTrusted || !target?.closest('.reader-page-window') || target.closest('button,a,input,textarea,[role=dialog],[role=menu]')) return;
      stop();
      if (readerFullscreenPreferred() && navigator.userActivation?.isActive) void withReaderFullscreenCover(requestReaderFullscreen).catch(() => {});
    };
    if (matchMedia('(max-width: 1023px)').matches && readerFullscreenSupported() && !readerFullscreenActive()) {
      document.addEventListener('click', firstTap, true);
      stopChange = listenFullscreenChange(stop);
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

  return {supported, active, pending, error, enabled, hint: active && !entryPending && !hintDismissed && !dismissedInSession, dismissHint, change, toggle: () => change(!readerFullscreenActive(), true), clearError: () => setError('')};
}
