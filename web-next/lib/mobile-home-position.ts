// A Featured browsing position belongs to this document, not persistent storage.
// Main-section visits retain it; five minutes away from those sections expires it.
const awayLimit = 5 * 60 * 1000;
let top = 0;
let rails: {key: string | null; position: number}[] = [];
let path = '';
let awaySince: number | undefined;
let restoring = false;
let cancelRestore: (() => void) | undefined;
const mobile = () => matchMedia('(max-width: 767px)').matches;
const featured = (href: string) => href.split('?')[0] === '/' && !new URL(href, location.origin).searchParams.has('view');
const mainSection = (href: string) => featured(href) || ['/library', '/forum'].includes(href.split('?')[0]);
const home = () => [...document.querySelectorAll<HTMLElement>('.mobile-home[data-home-href]')]
  .find(element => element.getBoundingClientRect().width > 0 && featured(element.dataset.homeHref!));

export function mobileHomeScroll() {
  return awaySince !== undefined && Date.now() - awaySince >= awayLimit ? 0 : top;
}

export function rememberMobileHomeScroll() {
  const page = mobile() && featured(path) && !restoring ? home() : undefined;
  if (!page) return;
  top = window.scrollY;
  rails = [...page.querySelectorAll<HTMLElement>('.mh-banner-track, .mh-shelf')].map(rail => ({
    key: rail.querySelector('a')?.getAttribute('href') ?? null, position: rail.clientWidth ? rail.scrollLeft / rail.clientWidth : 0,
  }));
}

// Called by the existing history integration before the outgoing DOM disappears.
export function trackMobileHomeRoute(next: string) {
  if (next === path) return;
  rememberMobileHomeScroll();
  cancelRestore?.();
  if (mainSection(next)) {
    if (awaySince !== undefined && Date.now() - awaySince >= awayLimit) rails = [];
    top = mobileHomeScroll();
    awaySince = undefined;
  } else if (mainSection(path) && awaySince === undefined) awaySince = Date.now();
  path = next;
}

function restore() {
  cancelRestore?.();
  if (!mobile() || !featured(path)) return;
  const target = mobileHomeScroll();
  restoring = true;
  let frame = 0;
  const finish = () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    restoring = false;
    if (cancelRestore === finish) cancelRestore = undefined;
  };
  const apply = () => {
    const page = home();
    if (!page) return;
    observer.disconnect();
    const restoreRails = () => page.querySelectorAll<HTMLElement>('.mh-banner-track, .mh-shelf').forEach((rail, index) => {
      const saved = rails[index], key = rail.querySelector('a')?.getAttribute('href') ?? null;
      const position = saved?.key === key ? saved.position : rail.querySelector('[data-banner-clone]') ? 1 : 0;
      rail.scrollTo({left: position * rail.clientWidth, behavior: 'instant'});
    });
    window.scrollTo({top: target, behavior: 'instant'});
    restoreRails();
    // Next's focus/scroll pass and native popstate restoration can run after
    // layout effects. Keep the requested position through those two frames.
    frame = requestAnimationFrame(() => {
      window.scrollTo({top: target, behavior: 'instant'});
      restoreRails();
      frame = requestAnimationFrame(() => {window.scrollTo({top: target, behavior: 'instant'}); restoreRails(); finish();});
    });
  };
  const observer = new MutationObserver(apply);
  cancelRestore = finish;
  observer.observe(document.body, {childList: true, subtree: true});
  apply();
}

export function syncMobileHomePosition(next: string) {
  trackMobileHomeRoute(next);
  restore();
}

export function installMobileHomePosition() {
  const clear = () => {cancelRestore?.(); top = 0; rails = []; awaySince = undefined;};
  const show = () => {clear(); syncMobileHomePosition(location.pathname + location.search);};
  const interrupt = () => {cancelRestore?.();};
  window.addEventListener('scroll', rememberMobileHomeScroll, {passive: true});
  window.addEventListener('pagehide', clear);
  window.addEventListener('pageshow', show);
  window.addEventListener('touchstart', interrupt, {passive: true});
  window.addEventListener('wheel', interrupt, {passive: true});
  return () => {
    cancelRestore?.();
    window.removeEventListener('scroll', rememberMobileHomeScroll);
    window.removeEventListener('pagehide', clear);
    window.removeEventListener('pageshow', show);
    window.removeEventListener('touchstart', interrupt);
    window.removeEventListener('wheel', interrupt);
  };
}
