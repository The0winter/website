'use client';

import {captureMobileSection} from './mobile-section-snapshot';

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

function createTransition(href: string, dragging = false): MobileSectionDrag | undefined {
  if (!matchMedia('(max-width: 767px)').matches) return;
  const target = new URL(href, location.origin);
  const from = sections.indexOf(location.pathname), to = sections.indexOf(target.pathname);
  active?.cancel();
  if (target.origin !== location.origin || from < 0 || to < 0 || from === to ||
    (from === 1 && new URLSearchParams(location.search).has('view')) || (to === 1 && target.searchParams.has('view'))) return;
  const source = [...document.querySelectorAll<HTMLElement>(selectors[from])].find(page => page.getBoundingClientRect().width > 0);
  const nav = source?.querySelector<HTMLElement>('.mh-bottom'), bar = source?.querySelector<HTMLElement>('.mh-topbar');
  if (!source || !nav || !bar || !nav.getBoundingClientRect().height) return;

  const root = document.documentElement;
  const top = Math.max(0, bar.getBoundingClientRect().bottom + parseFloat(getComputedStyle(bar).marginBottom));
  const height = nav.getBoundingClientRect().top - top, width = root.clientWidth;
  const direction = to > from ? 1 : -1;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const key = `${previewUser}:${width}:${innerHeight}:${top}:${root.className}:${getComputedStyle(root).getPropertyValue('--home-background')}`;
  const animations: Animation[] = [];
  let frame = 0, cancelled = false, committed = false, returning = false, motionDone = false, offset = 0;
  // Entry routes start at the top and select the first inner tab.
  const cacheSource = scrollY === 0 && (from === 1 || (from === 0
    ? source.querySelector('#tab-shelf[aria-selected="true"]')
    : source.querySelector('[aria-label="论坛内容分类"] [aria-current="page"]')?.textContent === '推荐'));
  const outgoing = captureMobileSection(source, top, height).element;
  outgoing.dataset.sectionPane = 'outgoing';
  const header = captureMobileSection(bar, 0, top, true);
  const cached = previews.get(to);
  const incoming = cached?.key === key ? cached.element : document.createElement('div');
  if (cached?.key === key) previews.delete(to);
  else {
    incoming.className = 'mobile-section-snapshot mobile-section-preview';
    incoming.setAttribute('aria-hidden', 'true');
    incoming.inert = true;
    const title = document.createElement('div');
    title.className = 'mobile-section-preview-title';
    title.textContent = ['浏览记录　　书架', '精选', '推荐　　热榜　　关注'][to];
    const loading = document.createElement('p');
    loading.textContent = '加载中';
    const dots = document.createElement('span');
    dots.className = 'loading-dots'; dots.setAttribute('aria-hidden', 'true');
    loading.append(dots);
    incoming.append(title, loading);
  }
  incoming.dataset.sectionPane = 'preview';
  incoming.dataset.sectionPath = target.pathname;
  incoming.style.top = `${top}px`;
  incoming.style.height = `${height}px`;
  incoming.style.visibility = reduced ? 'hidden' : '';
  const backdrop = document.createElement('div');
  backdrop.className = 'mobile-section-backdrop';
  Object.assign(backdrop.style, {top: `${top}px`, height: `${height}px`});
  backdrop.setAttribute('aria-hidden', 'true');
  const position = (element: HTMLElement, x: number) => {element.style.transform = `translate3d(${reduced ? 0 : x}px,0,0)`;};
  position(outgoing, 0);
  position(incoming, direction * width);
  document.body.append(backdrop, outgoing, incoming, header.element);
  root.dataset.mobileSectionTransition = dragging ? 'dragging' : 'animating';

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    animations.forEach(animation => animation.cancel());
    [outgoing, incoming, backdrop, header.element].forEach(element => element.remove());
    if (cacheSource) {outgoing.style.transform = ''; previews.set(from, {element: outgoing, key});}
    if (cached?.element === incoming) {incoming.style.transform = ''; previews.set(to, cached);}
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
    if ((event.target as Element).closest('.mh-bottom, .mh-topbar')) {
      if (event.isTrusted) cancel();
      return;
    }
    event.preventDefault(); event.stopPropagation();
  };
  const preventScroll = (event: Event) => {if (event.cancelable) event.preventDefault();};
  const ready = () => location.pathname === target.pathname && [...document.querySelectorAll<HTMLElement>(selectors[to])]
    .some(page => page.getBoundingClientRect().width > 0);
  const check = () => {
    if (cancelled || !committed) return;
    if (!sections.includes(location.pathname)) {cancel(); return;}
    if (!motionDone || !ready()) return;
    // Reveal the real route in place after it has laid out. No incoming clone,
    // style walk, or second slide interrupts an already-running animation.
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {if (ready()) cancel();});
  };
  const observer = new MutationObserver(check);
  const animate = (element: HTMLElement, x: number, destination: number, duration: number) => {
    animations.push(element.animate([{transform: `translate3d(${reduced ? 0 : x}px,0,0)`}, {transform: `translate3d(${reduced ? 0 : destination}px,0,0)`}],
      {duration, easing: 'cubic-bezier(.25,.5,.35,1)', fill: 'forwards'}));
  };
  const commit = () => {
    if (cancelled || committed || returning) return;
    committed = true;
    root.dataset.mobileSectionTransition = 'animating';
    incoming.dataset.sectionPane = 'incoming';
    incoming.style.visibility = '';
    const input = header.content.querySelector('input');
    if (input) {
      input.value = '';
      input.placeholder = to === 2 ? '搜索问题或文章' : '搜索书名、作者';
      input.setAttribute('aria-label', to === 2 ? '搜索你想看的问题或文章' : '搜索书名或作者');
    }
    // Continue from the finger's position immediately, but keep the full 400ms
    // settling motion even when only a short distance remains.
    const duration = reduced ? 0 : 400;
    observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy']});
    animate(outgoing, offset, -direction * width, duration);
    animate(incoming, direction * width + offset, 0, duration);
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (cancelled) return;
      motionDone = true;
      if (!ready()) root.dataset.mobileSectionTransition = 'loading';
      check();
    });
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

  if (!dragging) commit();
  return {
    update(dx) {
      if (cancelled || committed || returning) return;
      offset = -direction * Math.max(0, Math.min(width, -direction * dx));
      position(outgoing, offset);
      position(incoming, direction * width + offset);
    },
    release(shouldCommit) {
      if (cancelled || committed || returning) return;
      if (shouldCommit) {commit(); return;}
      returning = true;
      root.dataset.mobileSectionTransition = 'returning';
      const duration = reduced ? 0 : 180 * Math.abs(offset) / width;
      animate(outgoing, offset, 0, duration);
      animate(incoming, direction * width + offset, direction * width, duration);
      void Promise.allSettled(animations.map(animation => animation.finished)).then(cancel);
    },
    cancel,
  };
}

export function beginMobileSectionTransition(href: string) {
  if (active?.href === new URL(href, location.origin).href) {active.commit(); return true;}
  return Boolean(createTransition(href));
}

export function startMobileSectionDrag(source: Element | null, section: Section) {
  const link = sectionLink(source, section);
  if (!link) return;
  const drag = createTransition(link.href, true);
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
