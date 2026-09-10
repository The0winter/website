'use client';

import { usePathname } from 'next/navigation';
import { Gem, Library, MessageCircle, UserRound } from 'lucide-react';
import AccountLink from './AccountLink';
import Link from './PrefetchLink';
import './mobile-bottom-nav.css';

export default function MobileBottomNav({ onHomeSelect }: { onHomeSelect?: () => void }) {
  const pathname = usePathname();
  return <nav className="mh-bottom" aria-label="移动端主导航">
    <AccountLink href="/library" aria-current={pathname === '/library' ? 'page' : undefined}><Library/><span>书架</span></AccountLink>
    <Link href="/" aria-current={pathname === '/' ? 'page' : undefined} onClick={onHomeSelect}><Gem/><span>精选</span></Link>
    <Link href="/forum" aria-current={pathname.startsWith('/forum') ? 'page' : undefined}><MessageCircle/><span>论坛</span></Link>
    <AccountLink href="/profile" aria-current={pathname === '/profile' ? 'page' : undefined}><UserRound/><span>我</span></AccountLink>
  </nav>;
}
