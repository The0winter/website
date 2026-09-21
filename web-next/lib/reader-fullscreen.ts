import {freezeBookPage} from './book-transition';

const listeners = new Set<() => void>();
let owned = false;
let readers = 0;
let pending: Promise<void> | null = null;
let releaseViewport: (() => void) | null = null;
const notify = () => listeners.forEach(listener => listener());
export const readerFullscreenSupported = () => Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen);
export const readerFullscreenActive = () => document.fullscreenElement === document.documentElement;
export const readerFullscreenPending = () => Boolean(pending);
export const serverFullscreenSnapshot = () => false;
export const isReaderPath = (path: string) => /^\/book\/[^/?#]+\/[^/?#]+$/.test(path);
export const readerFullscreenPreferenceKey = 'reader_fullscreen';
export function readerFullscreenPreferred() {
  try {return localStorage.getItem(readerFullscreenPreferenceKey) !== 'false';}
  catch {return true;}
}

export function subscribeReaderFullscreen(listener: () => void) {
  listeners.add(listener);
  document.addEventListener('fullscreenchange', listener);
  return () => {listeners.delete(listener); document.removeEventListener('fullscreenchange', listener);};
}

// Android Back exits native fullscreen without traversing page history. Bridge
// that exit to reader navigation, while letting app-controlled exits stay put.
export function installReaderFullscreenBack(onBack: () => void) {
  let active = readerFullscreenActive();
  let generation = 0;
  const cancel = () => {generation++;};
  const foreground = () => !document.hidden && document.hasFocus();
  const onChange = () => {
    const wasActive = active;
    active = readerFullscreenActive();
    if (active) cancel();
    if (active || !wasActive || !owned) return;
    owned = false;
    if (document.fullscreenElement || !foreground() || !matchMedia('(max-width: 1023px)').matches || !isReaderPath(location.pathname)) return;
    const href = location.href;
    const exit = ++generation;
    // A history traversal or backgrounding can also end fullscreen. Give those
    // events time to arrive before issuing a second, unintended Back.
    void settleViewport().then(() => {
      if (exit === generation && foreground() && !readerFullscreenActive() && location.href === href) onBack();
    });
  };
  const onVisibility = () => {if (document.hidden) cancel();};
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('popstate', cancel, true);
  window.addEventListener('book-navigation-leave', cancel);
  window.addEventListener('pagehide', cancel);
  window.addEventListener('blur', cancel);
  return () => {
    cancel();
    document.removeEventListener('fullscreenchange', onChange);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('popstate', cancel, true);
    window.removeEventListener('book-navigation-leave', cancel);
    window.removeEventListener('pagehide', cancel);
    window.removeEventListener('blur', cancel);
  };
}

// Native fullscreen can start while Next is still loading the reader route.
// Opt into the cutout before that request, and keep it through metadata swaps.
function prepareFullscreenViewport() {
  if (releaseViewport) return;
  const changed = new Map<HTMLMetaElement, {original: string; applied: string}>();
  const ensure = () => {
    for (const meta of document.head.querySelectorAll<HTMLMetaElement>('meta[name="viewport"]')) {
      if (/(?:^|[,;])\s*viewport-fit\s*=\s*cover\s*(?:[,;]|$)/i.test(meta.content)) continue;
      const original = meta.content;
      const applied = original.split(/[,;]/).filter(part => !/^\s*viewport-fit\s*=/i.test(part)).join(',').replace(/,\s*$/, '') + ', viewport-fit=cover';
      changed.set(meta, {original, applied});
      meta.content = applied;
    }
  };
  const root = document.documentElement;
  const previousPaper = root.style.getPropertyValue('--reader-fullscreen-paper');
  const source = document.querySelector<HTMLElement>('.chapter-loading-page,.reader-entry-content');
  const paper = source ? getComputedStyle(source).backgroundColor : previousPaper;
  if (paper) root.style.setProperty('--reader-fullscreen-paper', paper);
  ensure();
  const observer = new MutationObserver(ensure);
  observer.observe(document.head, {childList: true, subtree: true, attributes: true, attributeFilter: ['content']});
  const onExit = () => {if (!readerFullscreenActive()) releaseViewport?.();};
  releaseViewport = () => {
    observer.disconnect();
    document.removeEventListener('fullscreenchange', onExit);
    releaseViewport = null;
    // The reader owns its cover viewport once mounted. A pending entry can
    // already have a reader URL while still displaying the source details.
    // Never replace a newer value supplied by the destination route.
    if (!isReaderPath(location.pathname) || !document.querySelector('.reader-entry-content')) {
      for (const [meta, value] of changed) if (meta.isConnected && meta.content === value.applied) meta.content = value.original;
      if (root.style.getPropertyValue('--reader-fullscreen-paper') === paper) {
        if (previousPaper) root.style.setProperty('--reader-fullscreen-paper', previousPaper);
        else root.style.removeProperty('--reader-fullscreen-paper');
      }
    }
  };
  document.addEventListener('fullscreenchange', onExit);
}

// Follow real viewport changes, without adding a fixed pause after the native
// animation. Three unchanged frames allow resize observers to finish layout.
function settleViewport() {
  return new Promise<void>(resolve => {
    let frame = 0, previous = '', stableFrames = 0;
    const finish = () => {cancelAnimationFrame(frame); clearTimeout(deadline); resolve();};
    const deadline = window.setTimeout(finish, 1000);
    const sample = () => {
      const viewport = visualViewport;
      const size = `${innerWidth}/${innerHeight}/${viewport?.width}/${viewport?.height}/${viewport?.offsetTop}`;
      stableFrames = size === previous ? stableFrames + 1 : 0;
      previous = size;
      if (document.hidden || stableFrames >= 3) {finish(); return;}
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
  });
}

export function requestReaderFullscreen(): Promise<void> {
  if (pending) return pending;
  if (readerFullscreenActive()) return Promise.resolve();
  owned = true;
  prepareFullscreenViewport();
  let native: Promise<void>;
  try {
    // Entry waits only for its paper transition, while activation is still live.
    native = document.documentElement.requestFullscreen({navigationUI: 'hide'});
  } catch (error) {owned = false; releaseViewport?.(); return Promise.reject(error);}
  const request = native.then(async () => {
    if (!owned) {if (readerFullscreenActive()) await document.exitFullscreen(); return;}
    await settleViewport();
  }).catch(error => {
    owned = false;
    releaseViewport?.();
    throw error;
  }).finally(() => {
    if (pending === request) {pending = null; notify();}
  });
  pending = request;
  notify();
  return request;
}

export function shouldEnterReaderFullscreen() {
  return readerFullscreenPreferred() && matchMedia('(max-width: 1023px)').matches && readerFullscreenSupported()
    && !readerFullscreenActive() && !isReaderPath(location.pathname) && Boolean(navigator.userActivation?.isActive);
}

export async function releaseReaderFullscreen() {
  releaseViewport?.();
  if (!owned) return;
  owned = false;
  if (readerFullscreenActive()) await document.exitFullscreen().catch(() => {});
}

export function retainReaderFullscreen() {
  readers++;
  return () => {
    readers--;
    // React's development effect replay or a reader remount is not a departure.
    queueMicrotask(() => {if (!readers) void releaseReaderFullscreen();});
  };
}

export async function withReaderFullscreenCover(action: () => Promise<void>) {
  const source = document.querySelector<HTMLElement>('.reader-entry-content');
  const cover = source ? freezeBookPage('reader-fullscreen-cover', source) : null;
  if (cover && source) cover.style.background = getComputedStyle(source).backgroundColor;
  try {await action();}
  finally {
    if (cover) {
      if (source?.isConnected && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        await cover.animate([{opacity: 1}, {opacity: 0}], {duration: 160, easing: 'ease-out', fill: 'forwards'}).finished.catch(() => {});
      }
      cover.remove();
    }
  }
}

export async function exitReaderFullscreen() {
  const wasOwned = owned;
  // Set this before the native event, including when called from settings.
  owned = false;
  try {await document.exitFullscreen();}
  catch (error) {owned = wasOwned && readerFullscreenActive(); throw error;}
  await settleViewport();
}
