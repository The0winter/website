'use client';

import { useEffect, useLayoutEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { installLoginNavigation, syncLoginRoute } from '@/lib/login-navigation';

export default function LoginNavigation() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  useEffect(() => installLoginNavigation(router), [router]);
  useLayoutEffect(() => { syncLoginRoute(); }, [pathname, search]);
  return null;
}
