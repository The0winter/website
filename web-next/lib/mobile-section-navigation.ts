'use client';

import {freezeBookPage} from './book-transition';

type Section = 'library' | 'home' | 'forum';
const sections = ['/library', '/', '/forum'];
const selectors = ['.library-page', '.mobile-home', '.forum-page'];
let cancelActive: (() => void) | undefined;

// Start before the link navigates, keeping the old screen until the new page
// has laid out. Both snapshots move together; the real bottom nav stays put.
export function beginMobileSectionTransition(href: string) {
  if (!matchMedia('(max-width: 767px)').matches) return false;
  const target = new URL(href, location.origin);
  const from = sections.indexOf(location.pathname), to = sections.indexOf(target.pathname);
  cancelActive?.();
  if (target.origin !== location.origin || from < 0 || to < 0 || from === to ||
    (from === 1 && new URLSearchParams(location.search).has('view')) || (to === 1 && target.searchParams.has('view'))) return false;
  const source = [...document.querySelectorAll<HTMLElement>(selectors[from])].find(page => page.getBoundingClientRect().width > 0);
  const nav = source?.querySelector<HTMLElement>('.mh-bottom');
  if (!source || !nav || !nav.getBoundingClientRect().height) return false;

  const root = document.documentElement;
  const height = nav.getBoundingClientRect().top;
  const direction = to > from ? 1 : -1;
  const snapshots: HTMLElement[] = [];
  const animations: Animation[] = [];
  let frame = 0, settling = false, cancelled = false;
  const capture = (pane: 'outgoing' | 'incoming') => {
    const snapshot = freezeBookPage('mobile-section-snapshot', document.body, clone => {
      clone.querySelectorAll('.mh-bottom, .mobile-section-snapshot').forEach(element => element.remove());
    });
    snapshot.dataset.sectionPane = pane;
    snapshot.style.height = `${height}px`;
    snapshots.push(snapshot);
    return snapshot;
  };
  const outgoing = capture('outgoing');
  root.dataset.mobileSectionTransition = 'loading';

  const cancel = () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    animations.forEach(animation => animation.cancel());
    snapshots.forEach(snapshot => snapshot.remove());
    window.removeEventListener('popstate', cancel);
    window.removeEventListener('pagehide', cancel);
    window.removeEventListener('resize', cancel);
    document.removeEventListener('pointerdown', cancel, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('touchmove', preventScroll, true);
    document.removeEventListener('wheel', preventScroll, true);
    if (cancelActive === cancel) {cancelActive = undefined; delete root.dataset.mobileSectionTransition;}
  };
  const click = (event: MouseEvent) => {
    if ((event.target as Element).closest('.mh-bottom')) {cancel(); return;}
    event.preventDefault(); event.stopPropagation();
  };
  const preventScroll = (event: Event) => {if (event.cancelable) event.preventDefault();};
  const ready = () => location.pathname === target.pathname && [...document.querySelectorAll<HTMLElement>(selectors[to])]
    .some(page => page.getBoundingClientRect().width > 0);
  const check = () => {
    if (cancelled || settling) return;
    if (!sections.includes(location.pathname)) {cancel(); return;}
    if (!ready()) return;
    settling = true;
    frame = requestAnimationFrame(() => {frame = requestAnimationFrame(() => {
      if (cancelled) return;
      if (!ready()) {settling = false; check(); return;}
      observer.disconnect();
      const incoming = capture('incoming');
      root.dataset.mobileSectionTransition = 'animating';
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const options = {duration: 400, easing: 'cubic-bezier(.22,.7,.25,1)', fill: 'forwards' as const};
      animations.push(
        outgoing.animate([{transform: 'translateX(0)'}, {transform: `translateX(${reduced ? 0 : -direction * 100}%)`}], options),
        incoming.animate([{transform: `translateX(${reduced ? 0 : direction * 100}%)`}, {transform: 'translateX(0)'}], options),
      );
      void Promise.allSettled(animations.map(animation => animation.finished)).then(cancel);
    });});
  };
  const observer = new MutationObserver(check);
  observer.observe(document.body, {childList: true, subtree: true, attributes: true});
  cancelActive = cancel;
  window.addEventListener('popstate', cancel);
  window.addEventListener('pagehide', cancel);
  window.addEventListener('resize', cancel);
  // Keep the original swipe's release click blocked, but let a fresh gesture
  // take over immediately, before the destination's own handlers receive it.
  document.addEventListener('pointerdown', cancel, true);
  document.addEventListener('click', click, true);
  document.addEventListener('touchmove', preventScroll, {capture: true, passive: false});
  document.addEventListener('wheel', preventScroll, {capture: true, passive: false});
  return true;
}

// Use the same links as a tap, including session restoration and route prefetching.
export function navigateMobileSection(source: Element | null, section: Section) {
  if (!source || !matchMedia('(max-width: 767px)').matches) return false;
  const page = source.closest('.library-page, .mobile-home, .forum-page');
  const link = page?.querySelector<HTMLAnchorElement>(`.mh-bottom [data-section="${section}"]`);
  if (!link || page?.querySelector('dialog[open], [role="menu"]') || page?.getAttribute('data-managing') === 'true') return false;
  link.click();
  return true;
}
