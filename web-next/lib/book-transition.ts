type Direction = 'enter' | 'exit';
let cancelActive: (() => void) | undefined;

function visible(selector: string) {
  return [...document.querySelectorAll<HTMLElement>(selector)].some(element => element.getBoundingClientRect().width > 0);
}

function waitForPage(href: string, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const path = new URL(href, location.origin).pathname;
    const parts = path.split('/');
    const ready = () => location.pathname === path && (parts[1] === 'library'
      ? visible('.library-page, .account-loading')
      : parts[1] === 'author'
      ? visible('.author-page')
      : parts[3]
      ? visible(`[data-reader-chapter="${CSS.escape(parts[3])}"][data-reader-ready="true"]`)
      : parts[1] === 'book'
        ? visible(`.book-detail[data-book-id="${CSS.escape(parts[2])}"]`)
        : visible('.mobile-home, .desktop-home'));
    const finish = () => { observer.disconnect(); clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const observer = new MutationObserver(() => { if (ready()) finish(); });
    const timer = window.setTimeout(finish, 8000);
    signal.addEventListener('abort', finish, {once: true});
    observer.observe(document.body, {subtree: true, childList: true, attributes: true});
    if (ready() || signal.aborted) finish();
  });
}

// Keep the current screen visible while Next renders and the reader measures
// its pages. A closed shadow root isolates duplicate IDs and reader controls.
export function freezeBookPage(className = 'book-transition-snapshot') {
  const overlay = document.createElement('div');
  overlay.className = className;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  const shadow = overlay.attachShadow({mode: 'closed'});
  const style = document.createElement('style');
  style.textContent = [...document.styleSheets].map(sheet => {
    try { return [...sheet.cssRules].map(rule => rule.cssText).join('\n'); } catch { return ''; }
  }).join('\n') + '\n*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  shadow.append(style);
  const clone = document.body.cloneNode(true) as HTMLElement;
  const originals = [document.body, ...document.body.querySelectorAll<HTMLElement>('*')];
  const copies = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
  originals.forEach((original, index) => {
    const copy = copies[index];
    if (!copy) return;
    const position = getComputedStyle(original).position;
    if (position === 'fixed' || position === 'sticky') {
      const box = original.getBoundingClientRect();
      // The viewport bounds already include the current transform. Reapplying
      // it would move a copied, still-animating catalog a second time.
      Object.assign(copy.style, {position: 'fixed', top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px`, bottom: 'auto', right: 'auto', margin: '0', transform: 'none'});
    }
  });
  clone.querySelectorAll('script,iframe,.book-transition-snapshot,.chapter-entry-snapshot,.chapter-loading-page').forEach(element => element.remove());
  clone.style.margin = '0';
  clone.style.position = 'relative';
  clone.style.top = `${-window.scrollY}px`;
  const wrapper = document.createElement('div');
  wrapper.className = document.documentElement.className;
  const variables = getComputedStyle(document.documentElement);
  for (const key of variables) if (key.startsWith('--')) wrapper.style.setProperty(key, variables.getPropertyValue(key));
  wrapper.append(clone); shadow.append(wrapper); document.body.append(overlay);
  originals.forEach((original, index) => { if (copies[index]) { copies[index].scrollTop = original.scrollTop; copies[index].scrollLeft = original.scrollLeft; } });
  return overlay;
}

export function transitionBookPage(href: string, direction: Direction, navigate: () => void) {
  cancelActive?.();
  const controller = new AbortController();
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = direction === 'exit' ? visible('.reader-pages-root') ? 400 : 180 : 240;
  root.dataset.bookTransition = direction;
  root.dataset.bookTransitionPhase = 'loading';
  const cleanup = () => {
    if (cancelActive !== cancel) return;
    delete root.dataset.bookTransition;
    delete root.dataset.bookTransitionPhase;
    cancelActive = undefined;
  };
  let skip = () => {};
  const cancel = () => { controller.abort(); skip(); cleanup(); };
  cancelActive = cancel;
  const update = async () => {
    navigate();
    await waitForPage(href, controller.signal);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (!controller.signal.aborted) root.dataset.bookTransitionPhase = 'animating';
  };
  const snapshot = freezeBookPage();
  let incoming: HTMLElement | undefined;
  let animation: Animation | undefined;
  skip = () => { animation?.cancel(); incoming?.remove(); snapshot.remove(); };
  void update().then(async () => {
    if (!reduced && !controller.signal.aborted) {
      incoming = direction === 'enter' ? freezeBookPage() : undefined;
      const moving = incoming ?? snapshot;
      moving.dataset.motion = direction;
      animation = moving.animate(direction === 'exit'
        ? [{transform: 'translateX(0)'}, {transform: 'translateX(100%)'}]
        : [{transform: 'translateX(100%)'}, {transform: 'translateX(0)'}],
      {duration, easing: 'cubic-bezier(.22,.7,.25,1)', fill: 'forwards'});
      await animation.finished.catch(() => {});
    }
  }).finally(() => { incoming?.remove(); snapshot.remove(); cleanup(); });
}

export function cancelBookTransition() { cancelActive?.(); }
