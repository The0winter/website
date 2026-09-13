'use client';

import { useAuth } from '@/contexts/AuthContext';
import AccountLink from './AccountLink';
import UserAvatar from './UserAvatar';
import './mobile-account-link.css';
import {useReadingSettings} from '@/contexts/ReadingSettingsContext';

export default function MobileAccountLink({ dark: explicitDark }: { dark?: boolean }) {
  const { user } = useAuth();
  const {theme} = useReadingSettings();
  const dark = explicitDark ?? theme === 'dark';

  return <AccountLink href="/profile" className={`mobile-account-link${dark ? ' mobile-account-link--dark' : ''}`} aria-label="个人中心">
    <UserAvatar user={user} className="mobile-account-initial" dark={dark}/>
  </AccountLink>;
}
