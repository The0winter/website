let pending: Promise<unknown> | undefined;

// Download the shared detail UI alongside the route, instead of discovering
// its chunks only after the server's book data has arrived. No data is fetched
// and no component is mounted here. Retry a failed download on the next intent.
export function warmBookDetailCode() {
  pending ??= import('../components/BookDetailClient').catch(() => {pending = undefined;});
}

export const isBookDetailHref = (href: unknown): href is string =>
  typeof href === 'string' && /^\/book\/[^/?#]+(?:[?#].*)?$/.test(href);
