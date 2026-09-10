'use client';

import Link, { useLinkStatus } from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { currentPrefetchPolicy, observeBookVisibility, serverPrefetchPolicy, shouldPrefetchBook, subscribePrefetchPolicy } from '@/lib/book-prefetch';

type Props = Omit<ComponentProps<typeof Link>, 'prefetch' | 'ref'>;

function PendingFeedback() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span role="status" className="fixed inset-x-0 top-0 z-[100] h-1 bg-blue-500 motion-safe:animate-pulse pointer-events-none"><span className="sr-only">正在打开书籍…</span></span>;
}

export default function BookLink({ children, onMouseEnter, onFocus, onTouchStart, onBlur, ...props }: Props) {
  const anchor = useRef<HTMLAnchorElement>(null);
  const [visible, setVisible] = useState(false);
  const [intent, setIntent] = useState(false);
  const policy = useSyncExternalStore(subscribePrefetchPolicy, currentPrefetchPolicy, serverPrefetchPolicy);
  useEffect(() => {
    if (!anchor.current) return;
    return observeBookVisibility(anchor.current, isVisible => {
      setVisible(isVisible);
      if (!isVisible) setIntent(false);
    });
  }, []);
  // Full route data uses Next's bounded request scheduler, deduplication and
  // in-memory LRU. Disabling the Link cancels queued work once it leaves view.
  const prefetch = shouldPrefetchBook(policy, visible, intent);
  return <Link
    {...props}
    ref={anchor}
    prefetch={prefetch}
    onMouseEnter={event => { setIntent(true); onMouseEnter?.(event); }}
    onFocus={event => { setIntent(true); onFocus?.(event); }}
    onTouchStart={event => { setIntent(true); onTouchStart?.(event); }}
    onBlur={event => { setIntent(false); onBlur?.(event); }}
  >{children}<PendingFeedback /></Link>;
}
