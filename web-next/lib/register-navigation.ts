type Router = { back: () => void; replace: (href: string) => void };
type RegistrationEntry = { href: string; returnTo: string; canGoBack: boolean };
let previousHref = '';

function localDestination(value: string): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin || /^\/register(\/|$)/.test(url.pathname)) return;
    return url.pathname + url.search + url.hash;
  } catch { return; }
}

function entry(): RegistrationEntry | undefined {
  const value = history.state?.registrationNavigation as RegistrationEntry | undefined;
  return value?.href === location.pathname + location.search && localDestination(value.returnTo) ? value : undefined;
}

export function syncRegistrationRoute() {
  if (location.pathname !== '/register') {
    previousHref = localDestination(location.href) || '';
    return;
  }
  if (entry()) return;
  const registrationNavigation: RegistrationEntry = {
    href: location.pathname + location.search,
    returnTo: previousHref || localDestination(document.referrer) || '/',
    canGoBack: Boolean(previousHref),
  };
  history.replaceState({ ...history.state, registrationNavigation }, '', location.href);
}

export function leaveRegistration(router: Router) {
  const source = entry();
  if (source?.canGoBack) router.back();
  else router.replace(source?.returnTo || '/');
}

export function registrationLogin(router: Router) {
  const source = entry();
  if (source?.canGoBack && /^\/login(?:[?#]|$)/.test(source.returnTo)) router.back();
  else router.replace('/login');
}
