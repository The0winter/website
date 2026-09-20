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

export function subscribeReaderFullscreen(listener: () => void) {
  listeners.add(listener);
  document.addEventListener('fullscreenchange', listener);
  return () => {listeners.delete(listener); document.removeEventListener('fullscreenchange', listener);};
}

// The native toolbar animation can continue resizing after requestFullscreen
// resolves. Keep the reading paper covered until the final viewport settles.
function settleViewport() {
  return new Promise<void>(resolve => {
    let frame = 0, previous = '', stableSince = performance.now();
    const finish = () => {cancelAnimationFrame(frame); clearTimeout(deadline); resolve();};
    const deadline = window.setTimeout(finish, 1000);
    const sample = () => {
      const viewport = visualViewport;
      const size = `${innerWidth}/${innerHeight}/${viewport?.width}/${viewport?.height}/${viewport?.offsetTop}`;
      if (size !== previous) {previous = size; stableSince = performance.now();}
      if (document.hidden || performance.now() - stableSince >= 180) {finish(); return;}
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
    // Stay in the original click handler to retain Chrome's user activation.
    native = document.documentElement.requestFullscreen({navigationUI: 'hide'});
  } catch (error) {owned = false; return Promise.reject(error);}
  const request = native.then(async () => {
    if (!owned) {if (readerFullscreenActive()) await document.exitFullscreen(); return;}
    await settleViewport();
  }).finally(() => {
    if (pending === request) {pending = null; notify();}
  });
  pending = request;
  notify();
  return request;
}

export function shouldEnterReaderFullscreen() {
  return matchMedia('(max-width: 1023px)').matches && readerFullscreenSupported()
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
