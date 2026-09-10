'use client';

import Link, { useLinkStatus } from 'next/link';
import { useState, type ComponentProps } from 'react';

type Props = Omit<ComponentProps<typeof Link>, 'prefetch'> & { eager?: boolean };

function PendingFeedback() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span role="status" className="fixed inset-x-0 top-0 z-[100] h-1 bg-blue-500 motion-safe:animate-pulse pointer-events-none"><span className="sr-only">正在打开书籍…</span></span>;
}

export default function BookLink({ eager = false, children, onMouseEnter, onFocus, onTouchStart, ...props }: Props) {
  const [intent, setIntent] = useState(false);
  return <Link
    {...props}
    prefetch={eager || intent ? true : null}
    onMouseEnter={event => { setIntent(true); onMouseEnter?.(event); }}
    onFocus={event => { setIntent(true); onFocus?.(event); }}
    onTouchStart={event => { setIntent(true); onTouchStart?.(event); }}
  >{children}<PendingFeedback /></Link>;
}
