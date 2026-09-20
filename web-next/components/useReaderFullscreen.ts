'use client';

import {useEffect, useRef, useState, useSyncExternalStore} from 'react';

const subscribe = (notify: () => void) => {
  document.addEventListener('fullscreenchange', notify);
  return () => document.removeEventListener('fullscreenchange', notify);
};
const serverSnapshot = () => false;
const supportedSnapshot = () => Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen);
const activeSnapshot = () => document.fullscreenElement === document.documentElement;

export function useReaderFullscreen(onEntered: () => void) {
  // Include the document-level chapter loading, error and transition overlays.
  const owned = useRef(false);
  const mounted = useRef(false);
  const supported = useSyncExternalStore(subscribe, supportedSnapshot, serverSnapshot);
  const active = useSyncExternalStore(subscribe, activeSnapshot, serverSnapshot);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    mounted.current = true;
    const releaseOwnership = () => {if (!activeSnapshot()) owned.current = false;};
    document.addEventListener('fullscreenchange', releaseOwnership);
    return () => {
      mounted.current = false;
      document.removeEventListener('fullscreenchange', releaseOwnership);
      if (owned.current && activeSnapshot()) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  const toggle = async () => {
    if (pending) return;
    setError('');
    setPending(true);
    try {
      if (activeSnapshot()) {
        await document.exitFullscreen();
      } else {
        // Call directly from the button gesture: Chrome requires user activation.
        owned.current = true;
        await document.documentElement.requestFullscreen({navigationUI: 'hide'});
        if (mounted.current) onEntered();
        else if (owned.current && activeSnapshot()) await document.exitFullscreen();
      }
    } catch {
      if (mounted.current) setError('未能切换全屏，请再点一次全屏按钮。');
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  return {supported, active, pending, error, toggle, clearError: () => setError('')};
}
