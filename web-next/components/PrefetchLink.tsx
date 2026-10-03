'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { canPrefetchHref, currentPrefetchPolicy, observeBookVisibility, serverPrefetchPolicy, shouldPrefetchBook, subscribePrefetchPolicy } from '@/lib/book-prefetch';
import {navigateBookLink} from '@/lib/book-navigation';
import {beginMobileSectionTransition} from '@/lib/mobile-section-navigation';
import {navigateMobileRoot} from '@/lib/mobile-root-history';
import {navigateMobileAuth} from '@/lib/mobile-auth-navigation';
import {isBookDetailHref, warmBookDetailCode} from '@/lib/book-detail-code';

type Props = Omit<ComponentProps<typeof Link>, 'prefetch' | 'ref'> & {
  prefetch?: false;
  prefetchMode?: 'visible' | 'intent';
  pendingLabel?: string;
};

function PendingFeedback({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span role="status" data-link-pending className="sr-only">{label}</span>;
}

export default function PrefetchLink({ children, href, prefetch: allowPrefetch, prefetchMode = 'visible', pendingLabel = '正在打开页面…', onMouseEnter, onMouseLeave, onFocus, onTouchStart, onBlur, onNavigate, ...props }: Props) {
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
  const prefetch = allowPrefetch !== false && canPrefetchHref(href, pathname) && shouldPrefetchBook(policy, visible, intent, prefetchMode);
  useEffect(() => {
    if (prefetch && isBookDetailHref(href)) warmBookDetailCode();
  }, [prefetch, href]);
  const warmOnIntent = () => {
    if (allowPrefetch !== false && policy !== 'paused' && isBookDetailHref(href)) warmBookDetailCode();
  };
  return <Link
    {...props}
    href={href}
    ref={anchor}
    prefetch={prefetch}
    onNavigate={event => {
      let cancelled = false;
      onNavigate?.({preventDefault() { cancelled = true; event.preventDefault(); }});
      if (!cancelled && typeof href === 'string' && (navigateMobileAuth(href) || navigateMobileRoot(href) || !beginMobileSectionTransition(href) && navigateBookLink(href))) {
        event.preventDefault();
      }
    }}
    onMouseEnter={event => { warmOnIntent(); setIntent(true); onMouseEnter?.(event); }}
    onMouseLeave={event => { setIntent(false); onMouseLeave?.(event); }}
    onFocus={event => { warmOnIntent(); setIntent(true); onFocus?.(event); }}
    onTouchStart={event => { warmOnIntent(); setIntent(true); onTouchStart?.(event); }}
    onBlur={event => { setIntent(false); onBlur?.(event); }}
  >{children}<PendingFeedback label={pendingLabel} /></Link>;
}
