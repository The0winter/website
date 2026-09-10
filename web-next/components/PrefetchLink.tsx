'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { canPrefetchHref, currentPrefetchPolicy, observeBookVisibility, serverPrefetchPolicy, shouldPrefetchBook, subscribePrefetchPolicy } from '@/lib/book-prefetch';

type Props = Omit<ComponentProps<typeof Link>, 'prefetch' | 'ref'> & {
  prefetchMode?: 'visible' | 'intent';
  pendingLabel?: string;
};

function PendingFeedback({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span role="status" className="fixed inset-x-0 top-0 z-[100] h-1 bg-blue-500 motion-safe:animate-pulse pointer-events-none"><span className="sr-only">{label}</span></span>;
}

export default function PrefetchLink({ children, href, prefetchMode = 'visible', pendingLabel = '正在打开页面…', onMouseEnter, onMouseLeave, onFocus, onTouchStart, onBlur, ...props }: Props) {
  const anchor = useRef<HTMLAnchorElement>(null);
  const [visible, setVisible] = useState(false);
  const [intent, setIntent] = useState(false);
  const pathname = usePathname();
  const policy = useSyncExternalStore(subscribePrefetchPolicy, currentPrefetchPolicy, serverPrefetchPolicy);
  useEffect(() => {
    if (!anchor.current) return;
    return observeBookVisibility(anchor.current, isVisible => {
      setVisible(isVisible);
      if (!isVisible) setIntent(false);
    });
  }, []);
  // Next shares its bounded scheduler, deduplication and memory cache across
  // every link. Offscreen/hidden links stop contributing speculative work.
  const prefetch = canPrefetchHref(href, pathname) && shouldPrefetchBook(policy, visible, intent, prefetchMode);
  return <Link
    {...props}
    href={href}
    ref={anchor}
    prefetch={prefetch}
    onMouseEnter={event => { setIntent(true); onMouseEnter?.(event); }}
    onMouseLeave={event => { setIntent(false); onMouseLeave?.(event); }}
    onFocus={event => { setIntent(true); onFocus?.(event); }}
    onTouchStart={event => { setIntent(true); onTouchStart?.(event); }}
    onBlur={event => { setIntent(false); onBlur?.(event); }}
  >{children}<PendingFeedback label={pendingLabel} /></Link>;
}
