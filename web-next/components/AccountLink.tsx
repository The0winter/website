'use client';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import type { AuthUser } from '@/lib/api';
import Link from './PrefetchLink';

type Props = Omit<ComponentProps<typeof Link>, 'href' | 'onNavigate'> & { href: '/library' | '/profile' };

export default function AccountLink({ href, children, ...props }: Props) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [waiting, setWaiting] = useState(false);
  const proceed = useRef<((user: AuthUser | null) => void) | null>(null);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => { if (!loading) proceed.current?.(user); }, [loading, user]);
  useEffect(() => () => cleanup.current?.(), []);

  return <Link {...props} href={loading || user ? href : '/login'} aria-busy={waiting || undefined}
    onNavigate={event => {
      if (!loading) return;
      event.preventDefault();
      cleanup.current?.();
      setWaiting(true);
      const source = location.href;
      const cancel = () => { cleanup.current?.(); setWaiting(false); };
      const anotherClick = (event: MouseEvent) => {
        if ((event.target as Element).closest('a,button')) cancel();
      };
      // Stay on the current page while the session is restored. A later click
      // or browser Back cancels this intent, including during a slow request.
      document.addEventListener('click', anotherClick, true);
      window.addEventListener('popstate', cancel, true);
      cleanup.current = () => {
        document.removeEventListener('click', anotherClick, true);
        window.removeEventListener('popstate', cancel, true);
        proceed.current = null;
        cleanup.current = null;
      };
      proceed.current = sessionUser => {
        cleanup.current?.();
        setWaiting(false);
        if (location.href === source) router.push(sessionUser ? href : '/login');
      };
    }}>
    {children}
    {waiting && <span className="sr-only" role="status">正在确认登录状态…</span>}
  </Link>;
}
