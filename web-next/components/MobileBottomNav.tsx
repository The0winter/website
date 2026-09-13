'use client';

import { usePathname } from 'next/navigation';
import { Gem, Library, MessageCircle } from 'lucide-react';
import AccountLink from './AccountLink';
import Link from './PrefetchLink';
import MobileWriterLaunch from './MobileWriterLaunch';
import './mobile-bottom-nav.css';

export default function MobileBottomNav({ onHomeSelect }: { onHomeSelect?: () => void }) {
  const pathname = usePathname();
  return <nav className="mh-bottom" aria-label="移动端主导航">
    <AccountLink data-section="library" href="/library" aria-current={pathname === '/library' ? 'page' : undefined}><Library/><span>书架</span></AccountLink>
    <Link data-section="home" href="/" aria-current={pathname === '/' ? 'page' : undefined} onClick={onHomeSelect}><Gem/><span>精选</span></Link>
    <Link data-section="forum" href="/forum" aria-current={pathname.startsWith('/forum') ? 'page' : undefined}><MessageCircle/><span>论坛</span></Link>
    <MobileWriterLaunch/>
  </nav>;
}
