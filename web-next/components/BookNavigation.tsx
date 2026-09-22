'use client';

import {useEffect, useLayoutEffect} from 'react';
import {usePathname, useRouter} from 'next/navigation';
import {installBookNavigation, syncBookRoute} from '@/lib/book-navigation';
import {installMobileRootHistory} from '@/lib/mobile-root-history';
import {installMobileHomePosition, syncMobileHomePosition} from '@/lib/mobile-home-position';
import './book-navigation.css';
import ChapterLoadingPage from './ChapterLoadingPage';
import {isReaderPath, releaseReaderFullscreen} from '@/lib/reader-fullscreen';

export default function BookNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const removeRoot = installMobileRootHistory(router);
    const removePosition = installMobileHomePosition();
    const removeBooks = installBookNavigation(router);
    return () => {removeBooks(); removeRoot(); removePosition();};
  }, [router]);
  useLayoutEffect(() => {
    const search = new URLSearchParams(location.search).toString();
    syncBookRoute(pathname + (search ? `?${search}` : ''));
    if (pathname === location.pathname) syncMobileHomePosition(pathname + (search ? `?${search}` : ''));
    if (pathname === location.pathname && !isReaderPath(pathname)) void releaseReaderFullscreen();
  }, [pathname]);
  return <ChapterLoadingPage/>;
}
