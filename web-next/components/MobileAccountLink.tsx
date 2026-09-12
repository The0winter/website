'use client';

import { UserRound } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import AccountLink from './AccountLink';
import './mobile-account-link.css';

export default function MobileAccountLink({ dark = false }: { dark?: boolean }) {
  const { user } = useAuth();
  const initial = Array.from(user?.username.trim() || '')[0]?.toUpperCase();

  return <AccountLink href="/profile" className={`mobile-account-link${dark ? ' mobile-account-link--dark' : ''}`} aria-label="个人中心">
    <span className="mobile-account-initial" aria-hidden="true">{initial || <UserRound size={18}/>}</span>
  </AccountLink>;
}
