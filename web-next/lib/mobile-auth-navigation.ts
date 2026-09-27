// The two small, public forms are bundled with the shared layout. Native
// history updates Next's pathname without fetching a second route/chunk first.
// Authentication and protected pages still use the normal session checks.
import {captureMobileSection} from './mobile-section-snapshot';
import {animateElement} from './browser-animation';

export type AuthSide = 'left' | 'right';
let available = false;
let current: {path: string; index: number; side: AuthSide} | undefined;
let pending: {path: string; side: AuthSide} | undefined;
let clearExit: (() => void) | undefined;
const mobile = () => matchMedia('(max-width: 767px)').matches;
const authPath = (path: string) => ['/login', '/register'].includes(path);
const savedSide = (state: typeof history.state, path: string): AuthSide => state?.mobileAuth?.path === path && state.mobileAuth.side === 'left' ? 'left' : 'right';

export function installMobileAuthNavigation() {
  available = true;
  const clear = () => clearExit?.();
  window.addEventListener('pagehide', clear);
  return () => { available = false; clear(); window.removeEventListener('pagehide', clear); };
}

export function syncMobileAuthPage(path: string) {
  const side = pending?.path === path ? pending.side : savedSide(history.state, path);
  pending = undefined;
  document.documentElement.style.setProperty('--auth-enter-x', side === 'left' ? '-100%' : '100%');
  current = {path, index: history.state?.mobileRoot?.index ?? 0, side: savedSide(history.state, path)};
}

function beginMobileAuthExit(side: AuthSide) {
  if (!mobile()) return;
  const page = document.querySelector<HTMLElement>('main .login-page, main .register-page');
  if (!page) return;
  clearExit?.();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // A closed, inert snapshot remains over the arriving route. It cannot expose
  // duplicate form fields or delay navigation while the old page slides away.
  const {element, content} = captureMobileSection(page, 0, innerHeight);
  content.style.minHeight = content.style.height = `${page.getBoundingClientRect().height}px`;
  element.className = 'auth-exit-snapshot';
  element.dataset.authExitSide = side;
  const viewport = document.createElement('div');
  viewport.className = 'auth-exit-viewport';
  viewport.setAttribute('aria-hidden', 'true');
  viewport.inert = true;
  viewport.append(element);
  document.body.append(viewport);
  const animation = animateElement(element, [{transform:'translate3d(0,0,0)'},
    {transform:`translate3d(${side === 'left' ? '-100%' : '100%'},0,0)`}],
    {duration:400, easing:'cubic-bezier(.22,.68,0,1)', fill:'forwards'});
  const clear = () => {animation.cancel(); viewport.remove(); if (clearExit === clear) clearExit = undefined;};
  clearExit = clear;
  void animation.finished.then(clear);
}

// React's pre-mutation snapshot runs while the departing form is still in the
// DOM. Popstate listeners may run after Next has already committed its restore.
export function prepareMobileAuthTransition(from: string, path: string) {
  if (!mobile()) return;
  const fromAuth = authPath(from), toAuth = authPath(path);
  const back = (history.state?.mobileRoot?.index ?? -1) < (current?.index ?? 0);
  const incoming: AuthSide = pending?.path === path ? pending.side : fromAuth ? back ? 'left' : 'right' : savedSide(history.state, path);
  if (fromAuth) beginMobileAuthExit(toAuth ? incoming === 'left' ? 'right' : 'left' : current?.side ?? 'right');
  if (toAuth) pending = {path, side:incoming};
}

export function navigateMobileAuth(href: string, side: AuthSide = 'right', replace = false) {
  if (!available || !mobile()) return false;
  const target = new URL(href, location.origin);
  if (target.origin !== location.origin || !authPath(target.pathname)) return false;
  if (target.href !== location.href) {
    pending = {path:target.pathname, side};
    // Do not copy __NA: Next only synchronizes usePathname for native entries
    // without that internal flag, and adds its own route state afterwards.
    history[replace ? 'replaceState' : 'pushState']({mobileAuth:{path:target.pathname, side}}, '', target.pathname + target.search + target.hash);
    window.scrollTo(0, 0);
  }
  return true;
}

export function openLogin(router: {push: (href: string) => void}, side: AuthSide = 'right') {
  if (!navigateMobileAuth('/login', side)) router.push('/login');
}
