'use client';

import {sectionSwipeThreshold, SECTION_TURN_DURATION, SECTION_TURN_EASING} from './section-swipe';
import {captureMobileSection, captureMobileSectionShell} from './mobile-section-snapshot';
import {mobileHomeScroll, rememberMobileHomeScroll} from './mobile-home-position';
import {animateElement, type BrowserAnimation} from './browser-animation';

type Section = 'library' | 'home' | 'forum';
export type MobileSectionDrag = {update: (dx: number) => void; release: (commit: boolean) => void; cancel: () => void};
const sections = ['/library', '/', '/forum'];
const selectors = ['.library-page', '.mobile-home', '.forum-page'];
let active: {href: string; commit: () => void; cancel: () => void; interrupt: () => boolean; pending: () => boolean; index: number; pane: HTMLElement} | undefined;
const previews = new Map<number, {element: HTMLElement; key: string; scroll: number}>();
let previewUser: string | undefined;
let navigate: ((href: string) => void) | undefined;
export function setMobileSectionNavigator(callback: (href: string) => void) {
  navigate = callback;
  return () => {if (navigate === callback) navigate = undefined;};
}
export function invalidateMobileSectionPreview(path: string) {previews.delete(sections.indexOf(path));}

export function setMobileSectionPreviewUser(user: string) {
  if (user !== previewUser) {previews.clear(); previewUser = user;}
}

// Touch-down may be the start of a system screenshot or a pinch. Only a
// deliberate single-finger swipe on the arrived route can take over its motion.
export function interruptMobileSectionTransition() {
  return active?.interrupt() ?? true;
}

function sectionLink(source: Element | null, section: Section) {
  if (!source || !matchMedia('(max-width: 767px)').matches) return;
  const page = source.closest('.library-page, .mobile-home, .forum-page');
  if (page?.querySelector('dialog[open], [role="menu"]') || page?.getAttribute('data-managing') === 'true') return;
  return page?.querySelector<HTMLAnchorElement>(`.mh-bottom [data-section="${section}"]`) ?? undefined;
}

function createTransition(href: string, dragging = false, sourceHref = location.href): MobileSectionDrag | undefined {
  if (!matchMedia('(max-width: 767px)').matches) return;
  const target = new URL(href, location.origin);
  const previous = active?.pending() ? active : undefined;
  const sourceUrl = new URL(sourceHref, location.origin);
  const from = previous?.index ?? sections.indexOf(sourceUrl.pathname), to = sections.indexOf(target.pathname);
  active?.cancel();
  if (target.origin !== location.origin || from < 0 || to < 0 || from === to ||
    (from === 1 && sourceUrl.searchParams.has('view')) || (to === 1 && target.searchParams.has('view'))) return;
  const source = [...document.querySelectorAll<HTMLElement>(previous ? selectors.join(', ') : selectors[from])].find(page => page.getBoundingClientRect().width > 0);
  const nav = source?.querySelector<HTMLElement>('.mh-bottom'), bar = source?.querySelector<HTMLElement>('.mh-topbar');
  if (!source || !nav || !bar || !nav.getBoundingClientRect().height) return;

  const root = document.documentElement;
  const top = Math.max(0, bar.getBoundingClientRect().bottom + parseFloat(getComputedStyle(bar).marginBottom));
  const height = nav.getBoundingClientRect().top - top, width = root.clientWidth;
  const direction = to > from ? 1 : -1;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const key = `${previewUser}:${width}:${top}:${root.className}:${getComputedStyle(root).getPropertyValue('--home-background')}`;
  const animations: BrowserAnimation[] = [];
  let frame = 0, cancelled = false, committed = false, returning = false, motionDone = false, offset = 0;
  rememberMobileHomeScroll();
  const sourceScroll = previous && from === 1 ? mobileHomeScroll() : scrollY;
  // Featured retains its browsing position. The other entry routes continue
  // to start at their first inner tab, so only cache their top-level frames.
  const cacheSource = previous || from === 1 || scrollY === 0 && (from === 0
    ? source.querySelector('#tab-shelf[aria-selected="true"]')
    : source.querySelector('[aria-label="论坛内容分类"] [aria-current="page"]')?.textContent === '推荐');
  const outgoing = previous?.pane ?? captureMobileSection(source, top, height).element;
  if (previous) previews.delete(from);
  outgoing.dataset.sectionPane = 'outgoing';
  const header = captureMobileSection(bar, 0, top, true);
  const preview = (index: number) => {
    const saved = index === 0 ? undefined : previews.get(index);
    return saved?.key === key && (index !== 1 || saved.scroll === mobileHomeScroll()) ? saved : undefined;
  };
  const cached = preview(to);
  const incoming = cached?.key === key ? cached.element : captureMobileSectionShell(target.pathname, top, height);
  if (!incoming) return;
  if (cached?.key === key) previews.delete(to);
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
    if (cacheSource) {outgoing.style.transform = ''; previews.set(from, {element: outgoing, key, scroll: sourceScroll});}
    if (cached?.element === incoming) {incoming.style.transform = ''; previews.set(to, cached);}
    window.removeEventListener('popstate', cancel);
    window.removeEventListener('pagehide', clear);
    window.removeEventListener('resize', resize);
    document.removeEventListener('click', click, true);
    document.removeEventListener('touchmove', preventScroll, true);
    document.removeEventListener('wheel', preventScroll, true);
    document.removeEventListener('pointerdown', pendingPointer, true);
    document.removeEventListener('touchstart', pendingStart, true);
    document.removeEventListener('touchmove', pendingMove, true);
    document.removeEventListener('touchend', pendingEnd, true);
    document.removeEventListener('touchcancel', pendingCancel, true);
    gesture?.preview?.remove();
    if (active?.cancel === cancel) {active = undefined; delete root.dataset.mobileSectionTransition;}
  };
  const clear = () => {cancel(); previews.clear();};
  const resize = () => {
    // Browser chrome and system overlays can change height during a pending
    // request. Keep its destination visible; a breakpoint/width change resets it.
    if (root.clientWidth !== width) {clear(); return;}
    const bottom = document.querySelector<HTMLElement>('.mh-bottom')?.getBoundingClientRect().top;
    if (bottom) [outgoing, incoming, backdrop].forEach(element => {element.style.height = `${Math.max(0, bottom - top)}px`;});
  };
  const click = (event: MouseEvent) => {
    // Once the route exists, a real tap may use its controls immediately. Touch
    // start alone is deliberately insufficient to dismiss the transition.
    if (event.isTrusted && committed && ready()) {cancel(); return;}
    if ((event.target as Element).closest('.mh-bottom, .mh-topbar')) {
      if (event.isTrusted) cancel();
      return;
    }
    event.preventDefault(); event.stopPropagation();
  };
  const preventScroll = (event: Event) => {
    if ('touches' in event && (event as TouchEvent).touches.length > 1) return;
    if (event.cancelable) event.preventDefault();
  };
  const ready = () => location.pathname === target.pathname && [...document.querySelectorAll<HTMLElement>(selectors[to])]
    .some(page => page.getBoundingClientRect().width > 0);
  const check = () => {
    if (cancelled || !committed) return;
    if (!sections.includes(location.pathname)) {cancel(); return;}
    if (gesture || !motionDone || !ready()) return;
    // Reveal the real route in place after it has laid out. No incoming clone,
    // style walk, or second slide interrupts an already-running animation.
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {if (ready()) cancel();});
  };
  const observer = new MutationObserver(check);
  const animate = (element: HTMLElement, x: number, destination: number, duration: number) => {
    // Preserve the destination when animation is unavailable or the watchdog
    // has to cancel a stalled effect.
    position(element, destination);
    animations.push(animateElement(element, [{transform: `translate3d(${reduced ? 0 : x}px,0,0)`}, {transform: `translate3d(${reduced ? 0 : destination}px,0,0)`}],
      {duration, easing: SECTION_TURN_EASING, fill: 'forwards'}));
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
    const duration = reduced ? 0 : SECTION_TURN_DURATION;
    observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy']});
    animate(outgoing, offset, -direction * width, duration);
    animate(incoming, direction * width + offset, 0, duration);
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (cancelled) return;
      motionDone = true;
      if (!ready() && !gesture) root.dataset.mobileSectionTransition = 'loading';
      check();
    });
    check();
  };
  // While a route request is pending, the visible destination owns gestures.
  // The underlying page may still be the previous section and must not interpret
  // this touch or cancel the new navigation when its component unmounts.
  let gesture: {x: number; y: number; dx: number; next?: number; preview?: HTMLElement} | undefined;
  const pending = () => committed && !cancelled && (!ready() || Boolean(gesture));
  const pendingPointer = (event: PointerEvent) => {
    if ((pending() || gesture) && !(event.target as Element).closest('.mh-bottom, .mh-topbar')) event.stopPropagation();
  };
  const pendingStart = (event: TouchEvent) => {
    if (!pending() && !gesture) return;
    if ((event.target as Element).closest('.mh-bottom, .mh-topbar')) return;
    event.stopPropagation();
    if (event.touches.length !== 1) {pendingCancel(); return;}
    gesture = {x: event.touches[0].clientX, y: event.touches[0].clientY, dx: 0};
  };
  const pendingMove = (event: TouchEvent) => {
    if (!gesture) return;
    event.stopPropagation();
    if (event.touches.length !== 1) {pendingCancel(); return;}
    const dx = event.touches[0].clientX - gesture.x, dy = event.touches[0].clientY - gesture.y;
    if (gesture.next === undefined && (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.25)) return;
    const next = to + (dx > 0 ? -1 : 1);
    if (next < 0 || next >= sections.length) {pendingCancel(); return;}
    if (gesture.next !== next) {
      gesture.preview?.remove();
      const cached = preview(next);
      gesture.preview = cached?.key === key ? cached.element : captureMobileSectionShell(sections[next], top, height);
      if (!gesture.preview) return;
      gesture.next = next;
      gesture.preview.dataset.sectionPane = 'preview';
      gesture.preview.style.visibility = '';
      gesture.preview.style.height = incoming.style.height;
      document.body.append(gesture.preview);
    }
    animations.forEach(animation => animation.cancel());
    motionDone = true;
    position(outgoing, -direction * width);
    gesture.dx = Math.max(-width, Math.min(width, dx));
    position(incoming, gesture.dx);
    position(gesture.preview!, (next > to ? width : -width) + gesture.dx);
    root.dataset.mobileSectionTransition = 'dragging';
    if (event.cancelable) event.preventDefault();
  };
  const pendingCancel = () => {
    gesture?.preview?.remove();
    gesture = undefined;
    if (cancelled) return;
    if (motionDone) {position(incoming, 0); position(outgoing, -direction * width);}
    root.dataset.mobileSectionTransition = motionDone ? 'loading' : 'animating';
    check();
  };
  const pendingEnd = (event: TouchEvent) => {
    if (!gesture) return;
    event.stopPropagation();
    const {next, dx} = gesture;
    if (next === undefined || Math.abs(dx) < sectionSwipeThreshold(width) || !navigate) {pendingCancel(); return;}
    const href = sections[next];
    // Preserve the visible pane as the outgoing frame. router.push also
    // supersedes an older request when returning to the currently mounted URL.
    const drag = createTransition(href, true);
    drag?.update(dx);
    drag?.release(true);
    navigate(href);
  };
  active = {href: target.href, commit, cancel, pending, index: to, pane: incoming, interrupt: () => {
    if (!committed) return true;
    if (!ready()) return false;
    cancel();
    return true;
  }};
  window.addEventListener('popstate', cancel);
  window.addEventListener('pagehide', clear);
  window.addEventListener('resize', resize);
  document.addEventListener('click', click, true);
  document.addEventListener('touchmove', preventScroll, {capture: true, passive: false});
  document.addEventListener('wheel', preventScroll, {capture: true, passive: false});
  document.addEventListener('pointerdown', pendingPointer, true);
  document.addEventListener('touchstart', pendingStart, {capture: true, passive: true});
  document.addEventListener('touchmove', pendingMove, {capture: true, passive: false});
  document.addEventListener('touchend', pendingEnd, true);
  document.addEventListener('touchcancel', pendingCancel, true);

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

export function beginMobileSectionReturn(sourceHref: string) {
  if (active?.href === new URL('/', location.origin).href) {active.commit(); return true;}
  return Boolean(createTransition('/', false, sourceHref));
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
