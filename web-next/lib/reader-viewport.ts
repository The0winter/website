// Native dvh follows browser chrome without JS reflows. Older Android engines
// need the layout viewport's measured height (100vh can include hidden bars).
export function installReaderViewport() {
  if (window.CSS?.supports?.('height', '100dvh')) return () => {};
  const root = document.documentElement;
  const previous = root.style.getPropertyValue('--reader-viewport-height');
  let frame = 0;
  const measure = () => {root.style.setProperty('--reader-viewport-height', `${window.innerHeight}px`);};
  const schedule = () => {cancelAnimationFrame(frame); frame = requestAnimationFrame(measure);};
  measure();
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    if (previous) root.style.setProperty('--reader-viewport-height', previous);
    else root.style.removeProperty('--reader-viewport-height');
  };
}

export function observeReaderSize(element: HTMLElement, update: () => void) {
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
  observer?.observe(element);
  window.addEventListener('resize', update);
  window.visualViewport?.addEventListener('resize', update);
  return () => {
    observer?.disconnect();
    window.removeEventListener('resize', update);
    window.visualViewport?.removeEventListener('resize', update);
  };
}
