'use client';

import {freezeBookPage} from './book-transition';

type Section = 'library' | 'home' | 'forum';
export type MobileSectionDrag = {update: (dx: number) => void; release: (commit: boolean) => void; cancel: () => void};
const sections = ['/library', '/', '/forum'];
const selectors = ['.library-page', '.mobile-home', '.forum-page'];
let active: {href: string; commit: () => void; cancel: () => void} | undefined;
const previews = new Map<number, {element: HTMLElement; key: string}>();
let previewUser: string | undefined;

export function setMobileSectionPreviewUser(user: string) {
  if (user !== previewUser) {previews.clear(); previewUser = user;}
}

function sectionLink(source: Element | null, section: Section) {
  if (!source || !matchMedia('(max-width: 767px)').matches) return;
  const page = source.closest('.library-page, .mobile-home, .forum-page');
  if (page?.querySelector('dialog[open], [role="menu"]') || page?.getAttribute('data-managing') === 'true') return;
  return page?.querySelector<HTMLAnchorElement>(`.mh-bottom [data-section="${section}"]`) ?? undefined;
}

function createTransition(href: string, startedAt?: number): MobileSectionDrag | undefined {
  if (!matchMedia('(max-width: 767px)').matches) return;
  const target = new URL(href, location.origin);
  const from = sections.indexOf(location.pathname), to = sections.indexOf(target.pathname);
  active?.cancel();
  if (target.origin !== location.origin || from < 0 || to < 0 || from === to ||
    (from === 1 && new URLSearchParams(location.search).has('view')) || (to === 1 && target.searchParams.has('view'))) return;
  const source = [...document.querySelectorAll<HTMLElement>(selectors[from])].find(page => page.getBoundingClientRect().width > 0);
  const nav = source?.querySelector<HTMLElement>('.mh-bottom');
  if (!source || !nav || !nav.getBoundingClientRect().height) return;

  const root = document.documentElement;
  const height = nav.getBoundingClientRect().top, width = root.clientWidth;
  const direction = to > from ? 1 : -1;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const key = `${previewUser}:${width}:${innerHeight}:${root.className}:${getComputedStyle(root).getPropertyValue('--home-background')}`;
  const animations: Animation[] = [];
  let frame = 0, settling = false, cancelled = false, committed = false, offset = 0;
  let incoming: HTMLElement | undefined, preview: HTMLElement | undefined, backdrop: HTMLElement | undefined;
  // Only the entry tab is reusable when coming back to this section.
  const cacheSource = from === 1 || (from === 0
    ? source.querySelector('#tab-shelf[aria-selected="true"]')
    : source.querySelector('[aria-label="论坛内容分类"] [aria-current="page"]')?.textContent === '推荐');
  const capture = (pane: 'outgoing' | 'incoming') => {
    const snapshot = freezeBookPage('mobile-section-snapshot', document.body, clone => {
      clone.querySelectorAll('.mh-bottom, .mobile-section-snapshot, .mobile-section-backdrop').forEach(element => element.remove());
    });
    snapshot.dataset.sectionPane = pane;
    snapshot.style.height = `${height}px`;
    return snapshot;
  };
  const outgoing = capture('outgoing');
  root.dataset.mobileSectionTransition = startedAt === undefined ? 'loading' : 'dragging';

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    animations.forEach(animation => animation.cancel());
    [outgoing, incoming, preview, backdrop].forEach(element => element?.remove());
    if (cacheSource) {outgoing.style.transform = ''; previews.set(from, {element: outgoing, key});}
    if (incoming) {incoming.style.transform = ''; previews.set(to, {element: incoming, key});}
    window.removeEventListener('popstate', cancel);
    window.removeEventListener('pagehide', clear);
    window.removeEventListener('resize', clear);
    document.removeEventListener('pointerdown', cancel, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('touchmove', preventScroll, true);
    document.removeEventListener('wheel', preventScroll, true);
    if (active?.cancel === cancel) {active = undefined; delete root.dataset.mobileSectionTransition;}
  };
  const clear = () => {cancel(); previews.clear();};
  const click = (event: MouseEvent) => {
    if ((event.target as Element).closest('.mh-bottom')) {
      // release() intentionally activates the normal link, including auth.
      if (event.isTrusted) cancel();
      return;
    }
    event.preventDefault(); event.stopPropagation();
  };
  const preventScroll = (event: Event) => {if (event.cancelable) event.preventDefault();};
  const ready = () => location.pathname === target.pathname && [...document.querySelectorAll<HTMLElement>(selectors[to])]
    .some(page => page.getBoundingClientRect().width > 0);
  const position = (element: HTMLElement, x: number) => {element.style.transform = `translateX(${reduced ? 0 : x}px)`;};
  const animate = (element: HTMLElement, x: number, destination: number, duration: number) => {
    animations.push(element.animate([{transform: `translateX(${reduced ? 0 : x}px)`}, {transform: `translateX(${reduced ? 0 : destination}px)`}],
      {duration, easing: 'cubic-bezier(.22,.7,.25,1)', fill: 'forwards'}));
  };
  const check = () => {
    if (cancelled || !committed || settling) return;
    if (!sections.includes(location.pathname)) {cancel(); return;}
    if (!ready()) return;
    settling = true;
    frame = requestAnimationFrame(() => {frame = requestAnimationFrame(() => {
      if (cancelled) return;
      if (!ready()) {settling = false; check(); return;}
      observer.disconnect();
      incoming = capture('incoming');
      position(incoming, direction * width + offset);
      preview?.remove();
      root.dataset.mobileSectionTransition = 'animating';
      const remaining = Math.max(0, 1 - Math.abs(offset) / width);
      // Finger travel counts towards the 400ms minimum for a fast flick.
      // A slow drag only settles its remaining distance, never replays a slide.
      const duration = startedAt === undefined ? 400 : Math.max(240 * remaining, 400 - (performance.now() - startedAt), 0);
      animate(outgoing, offset, -direction * width, duration);
      animate(incoming, direction * width + offset, 0, duration);
      void Promise.allSettled(animations.map(animation => animation.finished)).then(cancel);
    });});
  };
  const observer = new MutationObserver(check);
  const commit = () => {
    if (cancelled || committed) return;
    committed = true;
    root.dataset.mobileSectionTransition = 'loading';
    observer.observe(document.body, {childList: true, subtree: true, attributes: true});
    check();
  };
  active = {href: target.href, commit, cancel};
  window.addEventListener('popstate', cancel);
  window.addEventListener('pagehide', clear);
  window.addEventListener('resize', clear);
  document.addEventListener('pointerdown', cancel, true);
  document.addEventListener('click', click, true);
  document.addEventListener('touchmove', preventScroll, {capture: true, passive: false});
  document.addEventListener('wheel', preventScroll, {capture: true, passive: false});

  if (startedAt === undefined) commit();
  else {
    backdrop = document.createElement('div');
    backdrop.className = 'mobile-section-backdrop';
    backdrop.style.height = `${height}px`;
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.append(backdrop);
    const cached = previews.get(to);
    if (cached?.key === key) {preview = cached.element; previews.delete(to);}
    else {
      // The first visit has no rendered content yet. Show a themed loading
      // surface until the real route replaces it at the finger's position.
      preview = document.createElement('div');
      preview.className = 'mobile-section-snapshot mobile-section-preview';
      preview.setAttribute('aria-hidden', 'true');
      preview.inert = true;
      const title = document.createElement('div');
      title.className = 'mobile-section-preview-title';
      title.textContent = ['浏览记录　　书架', '精选', '推荐　　热榜　　关注'][to];
      const loading = document.createElement('p');
      loading.textContent = '加载中…';
      preview.append(title, loading);
    }
    preview.dataset.sectionPane = 'preview';
    preview.style.visibility = reduced ? 'hidden' : '';
    preview.style.height = `${height}px`;
    position(preview, direction * width);
    document.body.append(preview);
  }
  return {
    update(dx) {
      if (cancelled || committed || settling) return;
      offset = -direction * Math.max(0, Math.min(width, -direction * dx));
      position(outgoing, offset);
      if (preview) position(preview, direction * width + offset);
    },
    release(shouldCommit) {
      if (cancelled || committed || settling) return;
      if (shouldCommit) {commit(); return;}
      settling = true;
      root.dataset.mobileSectionTransition = 'returning';
      const duration = reduced ? 0 : 180 * Math.abs(offset) / width;
      animate(outgoing, offset, 0, duration);
      if (preview) animate(preview, direction * width + offset, direction * width, duration);
      void Promise.allSettled(animations.map(animation => animation.finished)).then(cancel);
    },
    cancel,
  };
}

// A tap uses the normal slide; a swipe hands its existing position to the route.
export function beginMobileSectionTransition(href: string) {
  if (active?.href === new URL(href, location.origin).href) {active.commit(); return true;}
  return Boolean(createTransition(href));
}

export function startMobileSectionDrag(source: Element | null, section: Section, startedAt: number) {
  const link = sectionLink(source, section);
  if (!link) return;
  const drag = createTransition(link.href, startedAt);
  if (!drag) return;
  return {...drag, release(commit: boolean) {
    if (!commit) {drag.release(false); return;}
    drag.release(true);
    if (!navigateMobileSection(source, section)) drag.cancel();
  }};
}

// Use the same links as a tap, including session restoration and prefetching.
export function navigateMobileSection(source: Element | null, section: Section) {
  const link = sectionLink(source, section);
  if (!link) return false;
  link.click();
  return true;
}
