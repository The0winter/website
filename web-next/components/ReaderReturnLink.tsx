'use client';

import {useSyncExternalStore} from 'react';
import {ChevronLeft} from 'lucide-react';
import {readerReturnHref, subscribeBookNavigation} from '@/lib/book-navigation';
import Link from './PrefetchLink';

export default function ReaderReturnLink({bookId, title}: {bookId: string; title: string}) {
  const href = useSyncExternalStore(subscribeBookNavigation, () => readerReturnHref(bookId), () => `/book/${bookId}`);
  return <Link className="reader-return" href={href} aria-label={`返回${href.startsWith('/library') ? '书架' : '书籍详情'}：${title}`}>
    <ChevronLeft size={20}/><span>{title}</span>
  </Link>;
}
