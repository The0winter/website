'use client';

type Section = 'library' | 'home' | 'forum';

// Use the same links as a tap, including session restoration and route prefetching.
export function navigateMobileSection(source: Element | null, section: Section) {
  if (!source || !matchMedia('(max-width: 767px)').matches) return false;
  const page = source.closest('.library-page, .mobile-home, .forum-page');
  const link = page?.querySelector<HTMLAnchorElement>(`.mh-bottom [data-section="${section}"]`);
  if (!link || page?.querySelector('dialog[open], [role="menu"]') || page?.getAttribute('data-managing') === 'true') return false;
  link.click();
  return true;
}
