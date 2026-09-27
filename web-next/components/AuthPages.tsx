'use client';

import {Component, useEffect, useLayoutEffect, type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {installMobileAuthNavigation, prepareMobileAuthTransition, syncMobileAuthPage} from '@/lib/mobile-auth-navigation';
import {installAuthViewport} from '@/lib/auth-viewport';
import LoginPage from './LoginPage';
import RegisterPage from './RegisterPage';
import './auth-pages.css';

class AuthTransition extends Component<{path: string; children: ReactNode}> {
  getSnapshotBeforeUpdate(previous: Readonly<{path: string; children: ReactNode}>) {
    if (previous.path !== this.props.path) prepareMobileAuthTransition(previous.path, this.props.path);
    return null;
  }
  componentDidUpdate() {}
  render() {return this.props.children;}
}

export default function AuthPages({children}: {children: ReactNode}) {
  const pathname = usePathname();
  useEffect(installMobileAuthNavigation, []);
  useLayoutEffect(() => {syncMobileAuthPage(pathname);}, [pathname]);
  const isAuthPage = pathname === '/login' || pathname === '/register';
  useLayoutEffect(() => {if (isAuthPage) return installAuthViewport();}, [isAuthPage]);
  // Also serves direct visits/reloads. Keeping one form instance here preserves
  // input and focus if an older Next route request finishes after a fast entry.
  return <AuthTransition path={pathname}>{pathname === '/login' ? <LoginPage/> : pathname === '/register' ? <RegisterPage/> : children}</AuthTransition>;
}
