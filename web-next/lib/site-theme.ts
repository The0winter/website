export type SiteTheme = 'light' | 'dark';

// Runs in <head> before the first paint, independently of React hydration.
// Only a reload or an internal document navigation continues a manual choice.
export const siteThemeScript = `(() => {
  const key = 'novelhub_visit_theme';
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let manual = null;
  try {
    const navigation = performance.getEntriesByType('navigation')[0];
    const internal = document.referrer && new URL(document.referrer).origin === location.origin;
    if (navigation?.type === 'reload' || navigation?.type === 'navigate' && internal) {
      const saved = sessionStorage.getItem(key);
      if (saved === 'light' || saved === 'dark') manual = saved;
    } else sessionStorage.removeItem(key);
  } catch {}
  const apply = () => {
    const theme = manual || (system.matches ? 'dark' : 'light');
    root.classList.toggle('dark', theme === 'dark');
    root.dataset.theme = theme;
    root.dataset.themePreference = manual ? 'manual' : 'system';
    root.style.colorScheme = theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
      meta.removeAttribute('media');
      meta.content = theme === 'dark' ? '#181614' : '#f9fafb';
    });
    window.dispatchEvent(new Event('site-theme-change'));
  };
  window.__siteTheme = {
    set: theme => {
      if (theme !== 'light' && theme !== 'dark') return;
      manual = theme;
      try { sessionStorage.setItem(key, theme); } catch {}
      apply();
    }
  };
  system.addEventListener('change', apply);
  window.addEventListener('pageshow', event => {
    // Returning from another website via the back/forward cache is a new visit.
    if (event.persisted) {
      manual = null;
      try { sessionStorage.removeItem(key); } catch {}
    }
    apply();
  });
  apply();
})();`;

export function currentSiteTheme(): SiteTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export const serverSiteTheme = (): SiteTheme => 'light';

export function subscribeSiteTheme(notify: () => void) {
  window.addEventListener('site-theme-change', notify);
  return () => window.removeEventListener('site-theme-change', notify);
}

export function setSiteTheme(theme: SiteTheme) {
  (window as Window & {__siteTheme?: {set: (theme: SiteTheme) => void}}).__siteTheme?.set(theme);
}
