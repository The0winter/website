'use client';

import {useEffect, useLayoutEffect} from 'react';
import {usePathname, useRouter} from 'next/navigation';
import {installBookNavigation, syncBookRoute} from '@/lib/book-navigation';
import {installMobileRootHistory} from '@/lib/mobile-root-history';
import './book-navigation.css';
import ChapterLoadingPage from './ChapterLoadingPage';

export default function BookNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const removeRoot = installMobileRootHistory(router);
    const removeBooks = installBookNavigation(router);
    return () => {removeBooks(); removeRoot();};
  }, [router]);
  useLayoutEffect(() => {
    const search = new URLSearchParams(location.search).toString();
    syncBookRoute(pathname + (search ? `?${search}` : ''));
  }, [pathname]);
  return <ChapterLoadingPage/>;
}
