export type PrefetchPolicy = 'visible' | 'intent' | 'paused';

export const shouldPrefetchBook = (policy: PrefetchPolicy, visible: boolean, intent: boolean, mode: 'visible' | 'intent' = 'visible') =>
  policy !== 'paused' && (intent || (visible && policy === 'visible' && mode === 'visible'));

export const canPrefetchHref = (href: unknown, pathname: string) =>
  typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') && href !== pathname;

export function bookPrefetchPolicy(state: {
  hidden: boolean;
  online: boolean;
  saveData?: boolean;
  effectiveType?: string;
}): PrefetchPolicy {
  if (state.hidden || !state.online) return 'paused';
  if (state.saveData || state.effectiveType === 'slow-2g' || state.effectiveType === '2g') return 'intent';
  return 'visible';
}

type Connection = EventTarget & { saveData?: boolean; effectiveType?: string };
const connection = () => (navigator as Navigator & { connection?: Connection }).connection;

export function currentPrefetchPolicy(): PrefetchPolicy {
  const network = connection();
  return bookPrefetchPolicy({
    hidden: document.visibilityState !== 'visible',
    online: navigator.onLine,
    saveData: network?.saveData,
    effectiveType: network?.effectiveType,
  });
}

export const serverPrefetchPolicy = (): PrefetchPolicy => 'paused';

const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach(listener => listener());
export function subscribePrefetchPolicy(listener: () => void) {
  if (subscribers.size === 0) {
    document.addEventListener('visibilitychange', notify);
    window.addEventListener('online', notify);
    window.addEventListener('offline', notify);
    connection()?.addEventListener('change', notify);
  }
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) {
      document.removeEventListener('visibilitychange', notify);
      window.removeEventListener('online', notify);
      window.removeEventListener('offline', notify);
      connection()?.removeEventListener('change', notify);
    }
  };
}

// One observer shared by book cards, navigation and reading links.
// A zero root margin excludes offscreen cards and CSS-hidden desktop/mobile lists.
let observer: IntersectionObserver | null = null;
const visibleListeners = new Map<Element, (visible: boolean) => void>();
export function observeBookVisibility(element: Element, listener: (visible: boolean) => void) {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) visibleListeners.get(entry.target)?.(
      entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0,
    );
  }, { rootMargin: '0px', threshold: 0 });
  visibleListeners.set(element, listener);
  observer.observe(element);
  return () => {
    observer?.unobserve(element);
    visibleListeners.delete(element);
    if (visibleListeners.size === 0) { observer?.disconnect(); observer = null; }
  };
}
