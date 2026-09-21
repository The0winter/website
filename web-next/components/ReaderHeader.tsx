'use client';

import {useSyncExternalStore} from 'react';
import ReaderReturnLink from './ReaderReturnLink';
import {readerFullscreenActive, serverFullscreenSnapshot, subscribeReaderFullscreen} from '@/lib/reader-fullscreen';

const mobile = () => matchMedia('(max-width: 1023px)').matches;
const serverMobile = () => true;
const subscribe = (notify: () => void) => {
  const query = matchMedia('(max-width: 1023px)');
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

export default function ReaderHeader({bookId, bookTitle, title, firstPage, toolsVisible}: {bookId: string; bookTitle: string; title: string; firstPage: boolean; toolsVisible: boolean}) {
  const isMobile = useSyncExternalStore(subscribe, mobile, serverMobile);
  const fullscreen = useSyncExternalStore(subscribeReaderFullscreen, readerFullscreenActive, serverFullscreenSnapshot);
  if (isMobile) return fullscreen ? <header className="reader-status-top" data-compact="true" data-open="true">
    <ReaderReturnLink bookId={bookId} title={firstPage ? bookTitle : title}/>
  </header> : null;
  return <header className="reader-status-top" data-open={toolsVisible} inert={!toolsVisible} aria-hidden={!toolsVisible}>
    <ReaderReturnLink bookId={bookId} title={title}/>
  </header>;
}
