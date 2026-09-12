type Direction = 'enter' | 'exit';
let cancelActive: (() => void) | undefined;

function visible(selector: string) {
  return [...document.querySelectorAll<HTMLElement>(selector)].some(element => element.getBoundingClientRect().width > 0);
}

function waitForPage(href: string, signal: AbortSignal, onSlow?: () => void) {
  return new Promise<void>(resolve => {
    const url = new URL(href, location.origin);
    const path = url.pathname;
    const parts = path.split('/');
    const ready = () => location.pathname === path && (parts[1] === 'library'
      ? visible('.library-page, .account-loading')
      : parts[1] === 'author'
      ? visible('.author-page')
      : parts[1] === 'ranking'
      ? visible('.ranking-content[aria-busy="false"]')
      : parts[3]
      ? visible(`[data-reader-chapter="${CSS.escape(parts[3])}"][data-reader-ready="true"]`)
      : parts[1] === 'book'
        ? visible(`.book-detail[data-book-id="${CSS.escape(parts[2])}"]`)
        : window.matchMedia('(max-width: 767px)').matches
          ? visible(`.mobile-home[data-home-href="${CSS.escape(path + (url.search ? `?${url.searchParams}` : ''))}"][aria-busy="false"]`)
          : visible('.desktop-home'));
    const finish = () => { observer.disconnect(); clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const observer = new MutationObserver(() => { if (ready()) finish(); });
    // Detail loading keeps its cover until the requested page actually exists.
    const timer = window.setTimeout(onSlow ?? finish, onSlow ? 20000 : 8000);
    signal.addEventListener('abort', finish, {once: true});
    observer.observe(document.body, {subtree: true, childList: true, attributes: true});
    if (ready() || signal.aborted) finish();
  });
}

function bookLoadingPage(href: string, label = '书籍') {
  const panel = document.createElement('div');
  panel.className = 'book-transition-snapshot book-navigation-loading';
  panel.tabIndex = -1;
  panel.setAttribute('aria-label', `正在打开${label}`);
  panel.setAttribute('aria-busy', 'true');
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  message.textContent = `正在打开${label}…`;
  panel.append(message);
  panel.addEventListener('wheel', event => event.preventDefault(), {passive: false});
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {event.preventDefault(); window.history.back();}
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) event.preventDefault();
  });
  document.body.append(panel);
  panel.focus({preventScroll: true});
  return {panel, slow: () => {
    panel.setAttribute('aria-busy', 'false');
    message.setAttribute('role', 'alert');
    message.textContent = `${label}暂时未能加载，请重试`;
    const actions = document.createElement('div');
    const retry = document.createElement('button'), back = document.createElement('button');
    retry.textContent = '重试'; back.textContent = '返回';
    retry.onclick = () => location.assign(href);
    back.onclick = () => window.history.back();
    actions.append(retry, back); panel.append(actions);
  }};
}

// Keep the current screen visible while Next renders and the reader measures
// its pages. A closed shadow root isolates duplicate IDs and reader controls.
export function freezeBookPage(className = 'book-transition-snapshot', source = document.body, prepareClone?: (clone: HTMLElement) => void) {
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
  const clone = source.cloneNode(true) as HTMLElement;
  const originals = [source, ...source.querySelectorAll<HTMLElement>('*')];
  const copies = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
  originals.forEach((original, index) => {
    const copy = copies[index];
    if (!copy) return;
    const computed = getComputedStyle(original);
    const position = computed.position;
    if (position === 'fixed' || position === 'sticky') {
      const box = original.getBoundingClientRect();
      if (position === 'sticky') {
        // Sticky elements still occupy a layout slot. Keep that slot when
        // freezing their viewport position, including nested scrolling headers.
        const spacer = copy.cloneNode(false) as HTMLElement;
        spacer.removeAttribute('id');
        Object.assign(spacer.style, {position: 'static', visibility: 'hidden', width: computed.width, height: computed.height, boxSizing: computed.boxSizing, transform: 'none'});
        copy.before(spacer);
      }
      // The viewport bounds already include the current transform. Reapplying
      // it would move a copied, still-animating catalog a second time.
      Object.assign(copy.style, {position: 'fixed', top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px`, bottom: 'auto', right: 'auto', margin: '0', transform: 'none'});
    }
  });
  clone.querySelectorAll('script,iframe,.book-transition-snapshot,.chapter-entry-snapshot,.chapter-loading-page').forEach(element => element.remove());
  clone.querySelectorAll('[data-entry-revealing]').forEach(element => element.removeAttribute('data-entry-revealing'));
  clone.style.margin = '0';
  if (source === document.body) {
    clone.style.position = 'relative';
    clone.style.top = `${-window.scrollY}px`;
  }
  prepareClone?.(clone);
  const wrapper = document.createElement('div');
  wrapper.className = document.documentElement.className;
  const variables = getComputedStyle(document.documentElement);
  for (const key of variables) if (key.startsWith('--')) wrapper.style.setProperty(key, variables.getPropertyValue(key));
  wrapper.append(clone); shadow.append(wrapper); document.body.append(overlay);
  originals.forEach((original, index) => { if (copies[index]) { copies[index].scrollTop = original.scrollTop; copies[index].scrollLeft = original.scrollLeft; } });
  return overlay;
}

export function transitionBookPage(href: string, direction: Direction, navigate: () => void, loadingLabel?: string) {
  cancelActive?.();
  const controller = new AbortController();
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Preserve the source page underneath the moving loader even if Next swaps
  // the route immediately (including a cached detail page).
  const snapshot = freezeBookPage();
  const loading = direction === 'enter' && (loadingLabel || /^\/book\/[^/?#]+$/.test(href)) ? bookLoadingPage(href, loadingLabel) : undefined;
  const duration = direction === 'exit' ? 400 : 240;
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
    await waitForPage(href, controller.signal, loading?.slow);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (!controller.signal.aborted) root.dataset.bookTransitionPhase = 'animating';
  };
  let incoming: HTMLElement | undefined;
  let animation: Animation | undefined;
  skip = () => { animation?.cancel(); incoming?.remove(); loading?.panel.remove(); snapshot.remove(); };
  // Only the loading page slides in. Loading and motion run together, with no
  // minimum display timer or second animation when the details are ready.
  if (loading && !reduced) {
    loading.panel.dataset.motion = 'enter';
    animation = loading.panel.animate(
      [{transform: 'translateX(100%)'}, {transform: 'translateX(0)'}],
      {duration: 400, easing: 'cubic-bezier(.22,.7,.25,1)', fill: 'forwards'},
    );
  }
  void Promise.all([update(), animation?.finished.catch(() => {})]).then(async () => {
    if (!loading && !reduced && !controller.signal.aborted) {
      incoming = direction === 'enter' ? freezeBookPage() : undefined;
      const moving = incoming ?? snapshot;
      moving.dataset.motion = direction;
      animation = moving.animate(direction === 'exit'
        ? [{transform: 'translateX(0)'}, {transform: 'translateX(100%)'}]
        : [{transform: 'translateX(100%)'}, {transform: 'translateX(0)'}],
      {duration, easing: 'cubic-bezier(.22,.7,.25,1)', fill: 'forwards'});
      await animation.finished.catch(() => {});
    }
  }).finally(() => { skip(); cleanup(); });
}

export function cancelBookTransition() { cancelActive?.(); }
