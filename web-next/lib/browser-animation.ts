export type BrowserAnimation = {finished: Promise<void>; cancel: () => void};

// Navigation must complete even when an embedded/older engine only implements
// part of Web Animations, or stops delivering completion events in the background.
export function animateElement(element: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions): BrowserAnimation {
  let animation: Animation | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish = () => {};
  const cancel = () => {try {animation?.cancel();} catch { /* An incomplete engine must not block cleanup. */ } finish();};
  const finished = new Promise<void>(resolve => {
    finish = () => {clearTimeout(timer); resolve();};
    if (typeof element.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) {finish(); return;}
    try {
      animation = element.animate(frames, options);
      animation.onfinish = finish;
      animation.oncancel = finish;
      const completion = animation.finished;
      if (completion && typeof completion.then === 'function') void completion.then(finish, finish);
      timer = setTimeout(cancel, Number(options.delay || 0) + Number(options.duration || 0) + 500);
    } catch {cancel();}
  });
  return {finished, cancel};
}
