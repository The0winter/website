'use client';

import {useEffect, type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {installMobileAuthNavigation} from '@/lib/mobile-auth-navigation';
import LoginPage from './LoginPage';
import RegisterPage from './RegisterPage';
import './auth-pages.css';

export default function AuthPages({children}: {children: ReactNode}) {
  const pathname = usePathname();
  useEffect(installMobileAuthNavigation, []);
  // Also serves direct visits/reloads. Keeping one form instance here preserves
  // input and focus if an older Next route request finishes after a fast entry.
  if (pathname === '/login') return <LoginPage/>;
  if (pathname === '/register') return <RegisterPage/>;
  return children;
}
