'use client';

import {useEffect, useLayoutEffect} from 'react';
import {usePathname, useRouter} from 'next/navigation';
import {installBookNavigation, syncBookRoute} from '@/lib/book-navigation';
import './book-navigation.css';

export default function BookNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => installBookNavigation(router), [router]);
  useLayoutEffect(() => { syncBookRoute(pathname); }, [pathname]);
  return null;
}
