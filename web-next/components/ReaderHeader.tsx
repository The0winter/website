'use client';

import {useSyncExternalStore} from 'react';
import ReaderReturnLink from './ReaderReturnLink';

const mobile = () => matchMedia('(max-width: 1023px)').matches;
const serverMobile = () => true;
const subscribe = (notify: () => void) => {
  const query = matchMedia('(max-width: 1023px)');
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

export default function ReaderHeader({bookId, title, toolsVisible}: {bookId: string; title: string; toolsVisible: boolean}) {
  const isMobile = useSyncExternalStore(subscribe, mobile, serverMobile);
  if (isMobile) return null;
  return <header className="reader-status-top" data-open={toolsVisible} inert={!toolsVisible} aria-hidden={!toolsVisible}>
    <ReaderReturnLink bookId={bookId} title={title}/>
  </header>;
}
