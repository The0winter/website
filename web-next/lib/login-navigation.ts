type Router = { back: () => void; replace: (href: string) => void };
type LoginEntry = { href: string; returnTo: string };
let previousPublicHref = '';

function publicHref(value: string): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin || /^\/(login|register|profile|library|writer)(\/|$)/.test(url.pathname)) return;
    return url.pathname + url.search + url.hash;
  } catch { return; }
}

function loginEntry(): LoginEntry | undefined {
  const entry = history.state?.loginNavigation as LoginEntry | undefined;
  return entry?.href === location.pathname + location.search && publicHref(entry.returnTo) ? entry : undefined;
}

export function syncLoginRoute() {
  const href = location.pathname + location.search + location.hash;
  if (location.pathname !== '/login') {
    previousPublicHref = publicHref(href) || previousPublicHref;
    return;
  }
  // Keep the source in this history entry so refresh and Forward reuse it.
  if (loginEntry()) return;
  const source = previousPublicHref || publicHref(document.referrer) || '/';
  const entry: LoginEntry = { href: location.pathname + location.search, returnTo: source };
  const state = { ...history.state, loginNavigation: entry };
  if (!previousPublicHref) {
    // Referrer alone cannot prove a predecessor exists (e.g. a new tab).
    history.replaceState({ ...history.state, loginFallback: source }, '', source);
    history.pushState(state, '', href);
  } else history.replaceState(state, '', href);
}

export function installLoginNavigation(router: Router) {
  const onPopState = (event: PopStateEvent) => {
    const destination = publicHref(event.state?.loginFallback);
    if (!destination) return;
    // The synthetic slot shares the login route tree; fetch its actual route.
    event.stopImmediatePropagation();
    const state = { ...history.state };
    delete state.loginFallback;
    history.replaceState(state, '', destination);
    router.replace(destination);
  };
  window.addEventListener('popstate', onPopState, true);
  return () => window.removeEventListener('popstate', onPopState, true);
}

export function leaveLogin(router: Router) {
  if (loginEntry()) router.back();
  else router.replace('/');
}
