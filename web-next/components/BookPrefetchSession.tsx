'use client';

import { useEffect } from 'react';

export default function BookPrefetchSession() {
  useEffect(() => {
    // A tab close/reload destroys the in-memory router cache. Browser history
    // can preserve the entire document in bfcache after leaving the site;
    // discard that old session on restore too. In-app navigation is unaffected.
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, []);
  return null;
}
