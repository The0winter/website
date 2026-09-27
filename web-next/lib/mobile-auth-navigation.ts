// The two small, public forms are bundled with the shared layout. Native
// history updates Next's pathname without fetching a second route/chunk first.
// Authentication and protected pages still use the normal session checks.
let available = false;

export function installMobileAuthNavigation() {
  available = true;
  return () => { available = false; };
}

export function navigateMobileAuth(href: string) {
  if (!available || !matchMedia('(max-width: 767px)').matches) return false;
  const target = new URL(href, location.origin);
  if (target.origin !== location.origin || !['/login', '/register'].includes(target.pathname)) return false;
  if (target.href !== location.href) {
    // Do not copy __NA: Next only synchronizes usePathname for native entries
    // without that internal flag, and adds its own route state afterwards.
    history.pushState({}, '', target.pathname + target.search + target.hash);
    window.scrollTo(0, 0);
  }
  return true;
}

export function openLogin(router: {push: (href: string) => void}) {
  if (!navigateMobileAuth('/login')) router.push('/login');
}
