import {freezeBookPage} from './book-transition';

const listeners = new Set<() => void>();
let owned = false;
let readers = 0;
let pending: Promise<void> | null = null;
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
  let native: Promise<void>;
  try {
    // Entry waits only for its paper transition, while activation is still live.
    native = document.documentElement.requestFullscreen({navigationUI: 'hide'});
  } catch (error) {owned = false; return Promise.reject(error);}
  const request = native.then(async () => {
    if (!owned) {if (readerFullscreenActive()) await document.exitFullscreen(); return;}
    await settleViewport();
  }).catch(error => {
    owned = false;
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
  await document.exitFullscreen();
  owned = false;
  await settleViewport();
}
