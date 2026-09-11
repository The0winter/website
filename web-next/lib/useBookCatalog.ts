'use client';

import {useEffect, useMemo, useSyncExternalStore} from 'react';
import {getBookCatalog, type CatalogNetwork, type CatalogSeed} from './book-catalog';
import {currentPrefetchPolicy, serverPrefetchPolicy, subscribePrefetchPolicy} from './book-prefetch';

export function useBookCatalog(bookId: string, version: number | undefined, anchor: string | undefined, open: boolean, seed?: CatalogSeed) {
  const catalog = useMemo(() => getBookCatalog(bookId, version, seed), [bookId, version, seed]);
  const server = useMemo(() => catalog.getSnapshot(), [catalog]);
  const snapshot = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot, () => server);
  const policy = useSyncExternalStore(subscribePrefetchPolicy, currentPrefetchPolicy, serverPrefetchPolicy);
  useEffect(() => {
    if (policy === 'paused') return;
    const network = (navigator as Navigator & {connection?: CatalogNetwork}).connection;
    return catalog.watch(anchor, open && policy === 'visible', network, version);
  }, [catalog, anchor, open, policy, version]);
  return {snapshot, ensureRange: catalog.ensureRange, retry: catalog.retry};
}
