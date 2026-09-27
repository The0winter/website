let pending: Promise<unknown> | undefined;

// Download the shared detail UI alongside the route, instead of discovering
// its chunks only after the server's book data has arrived. No data is fetched
// and no component is mounted here. Retry a failed download on the next intent.
export function warmBookDetailCode() {
  pending ??= import('../components/BookDetailClient').catch(() => {pending = undefined;});
}

// Home warms the shared UI once, even when data prefetching is intent-only.
// Let the first frame paint before scheduling work; older mobile browsers may
// have neither idle callbacks nor IntersectionObserver. Never mount the UI or
// fetch individual books here, and defer hidden/offline tabs until they return.
export function scheduleBookDetailCodeWarmup() {
  let frame: number | undefined;
  let idle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    clearTimeout(timer);
    frame = idle = undefined;
    timer = undefined;
  };
  const ready = () => document.visibilityState === 'visible' && navigator.onLine;
  const warm = () => {if (ready()) warmBookDetailCode();};
  const schedule = () => {
    cancel();
    if (pending || !ready()) return;
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (typeof window.requestIdleCallback === 'function' && typeof window.cancelIdleCallback === 'function') {
          idle = window.requestIdleCallback(warm, {timeout: 1000});
        } else {
          timer = setTimeout(warm, 100);
        }
      });
    });
  };
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('online', schedule);
  window.addEventListener('offline', schedule);
  schedule();
  return () => {
    cancel();
    document.removeEventListener('visibilitychange', schedule);
    window.removeEventListener('online', schedule);
    window.removeEventListener('offline', schedule);
  };
}

export const isBookDetailHref = (href: unknown): href is string =>
  typeof href === 'string' && /^\/book\/[^/?#]+(?:[?#].*)?$/.test(href);
