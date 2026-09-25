type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void | Promise<void>;
};
type FullscreenElement = HTMLElement & {webkitRequestFullscreen?: () => void | Promise<void>};

const currentDocument = () => document as FullscreenDocument;
export const fullscreenElement = () => document.fullscreenElement || currentDocument().webkitFullscreenElement || null;
function requestMethod() {
  const root = document.documentElement as FullscreenElement;
  if (typeof root.requestFullscreen === 'function' && document.fullscreenEnabled !== false) return () => root.requestFullscreen({navigationUI: 'hide'});
  if (typeof root.webkitRequestFullscreen === 'function' && currentDocument().webkitFullscreenEnabled !== false && typeof currentDocument().webkitExitFullscreen === 'function') return () => root.webkitRequestFullscreen!();
  return null;
}
export const fullscreenSupported = () => Boolean(requestMethod());

export function listenFullscreenChange(listener: () => void) {
  document.addEventListener('fullscreenchange', listener);
  document.addEventListener('webkitfullscreenchange', listener);
  return () => {
    document.removeEventListener('fullscreenchange', listener);
    document.removeEventListener('webkitfullscreenchange', listener);
  };
}

// Prefixed APIs can return void. Wait for the actual state change instead of
// treating a successful JavaScript call as a successful fullscreen transition.
function changeFullscreen(enter: boolean, invoke: () => void | Promise<void>) {
  return new Promise<void>((resolve, reject) => {
    const matches = () => enter ? fullscreenElement() === document.documentElement : !fullscreenElement();
    const finish = (failure = false, error?: unknown) => {
      clearTimeout(timer); stop();
      document.removeEventListener('fullscreenerror', failed);
      document.removeEventListener('webkitfullscreenerror', failed);
      if (failure) reject(error || new Error('Fullscreen unavailable')); else resolve();
    };
    const changed = () => {if (matches()) finish();};
    const failed = () => finish(true);
    const stop = listenFullscreenChange(changed);
    const timer = setTimeout(failed, 2500);
    document.addEventListener('fullscreenerror', failed);
    document.addEventListener('webkitfullscreenerror', failed);
    try {void Promise.resolve(invoke()).then(changed, error => finish(true, error));} catch (error) {finish(true, error);}
  });
}

export function requestFullscreen() {
  const request = requestMethod();
  return request ? changeFullscreen(true, request) : Promise.reject(new Error('Fullscreen unavailable'));
}

export function exitFullscreen() {
  if (!fullscreenElement()) return Promise.resolve();
  const doc = currentDocument();
  return changeFullscreen(false, () => {
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') return document.exitFullscreen();
    if (typeof doc.webkitExitFullscreen === 'function') return doc.webkitExitFullscreen();
    throw new Error('Fullscreen exit unavailable');
  });
}
