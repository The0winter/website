// All browser mutations use the same-origin HttpOnly session and signed CSRF token.
export async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const headers = new Headers(init?.headers);
  headers.delete('Authorization');
  headers.delete('x-user-id');
  if (typeof window === 'undefined' && process.env.INTERNAL_API_SECRET) headers.set('x-internal-api-secret',process.env.INTERNAL_API_SECRET);
  if (typeof window !== 'undefined' && !['GET','HEAD','OPTIONS'].includes(method)) {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    if (url.origin !== window.location.origin) throw new Error('拒绝向外部地址发送账户操作');
    const response = await globalThis.fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('无法验证请求，请刷新重试');
    const { csrfToken } = await response.json();
    headers.set('x-csrf-token', csrfToken);
  }
  const response = await globalThis.fetch(input, { ...init, headers, credentials: 'same-origin', signal: init?.signal || AbortSignal.timeout(15000) });
  if (typeof window !== 'undefined' && response.ok && !['GET','HEAD','OPTIONS'].includes(method)) {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    const libraryWrite = /^\/api\/users\/([^/]+)\/(bookmarks|history)(?:\/|$)/.exec(url.pathname);
    if (libraryWrite) window.dispatchEvent(new CustomEvent('library-changed', {detail: {userId: libraryWrite[1]}}));
  }
  return response;
}

export interface CatalogPage<T> {
  rows: T[];
  total: number | null;
  // A small server-rendered preview may use a different size from background pages.
  pageSize?: number;
}

export interface CatalogOptions<T> {
  initialPage?: CatalogPage<T>;
  onProgress?: (rows: T[], total: number | null) => void;
  signal?: AbortSignal;
}

const catalogPageSize = 200;
const pendingCatalogPages = new Map<string, Promise<CatalogPage<unknown>>>();

// Share overlapping reads only. Completed requests are never cached across edits.
function readCatalogPage<T>(url: string, page: number): Promise<CatalogPage<T>> {
  const pageUrl = `${url}${url.includes('?') ? '&' : '?'}page=${page}&limit=${catalogPageSize}`;
  const pending = pendingCatalogPages.get(pageUrl);
  if (pending) return pending as Promise<CatalogPage<T>>;
  const request = (async () => {
    try {
      const response = await safeFetch(pageUrl);
      if (!response.ok) throw new Error('目录暂不可用，请重试');
      const rows: T[] = await response.json();
      const header = response.headers.get('X-Total-Count');
      const count = header === null ? NaN : Number(header);
      return { rows, total: Number.isSafeInteger(count) && count >= 0 ? count : null };
    } finally {
      pendingCatalogPages.delete(pageUrl);
    }
  })();
  pendingCatalogPages.set(pageUrl, request);
  return request;
}

export async function catalogPages<T>(url: string, options: CatalogOptions<T> = {}): Promise<T[]> {
  options.signal?.throwIfAborted();
  let first = options.initialPage;
  if (first && first.pageSize && first.pageSize !== catalogPageSize) {
    options.onProgress?.(first.rows, first.total);
    if (first.rows.length < first.pageSize || (first.total !== null && first.rows.length >= first.total)) return first.rows;
    // Page numbers use the 200-row background size. Restart at page one so the
    // shorter preview never causes skipped chapters or an incomplete catalog.
    first = undefined;
  }
  first ??= await readCatalogPage<T>(url, 1);
  options.signal?.throwIfAborted();
  const pages: T[][] = [first.rows];
  let result = [...first.rows];
  options.onProgress?.(result, first.total);
  if (first.rows.length < catalogPageSize) return result;

  // Older endpoints without a count still work, with progressive serial loading.
  if (first.total === null) {
    for (let page = 2; ; page++) {
      options.signal?.throwIfAborted();
      const { rows } = await readCatalogPage<T>(url, page);
      options.signal?.throwIfAborted();
      result = [...result, ...rows];
      options.onProgress?.(result, null);
      if (rows.length < catalogPageSize) return result;
    }
  }

  const lastPage = Math.ceil(first.total / catalogPageSize);
  let nextPage = 2;
  let contiguousPages = 1;
  let failed = false;
  const worker = async () => {
    while (!failed && nextPage <= lastPage) {
      options.signal?.throwIfAborted();
      const page = nextPage++;
      try {
        const { rows } = await readCatalogPage<T>(url, page);
        options.signal?.throwIfAborted();
        if (failed) return;
        pages[page - 1] = rows;
        const previous = contiguousPages;
        while (pages[contiguousPages]) contiguousPages++;
        if (previous !== contiguousPages) {
          // Publish contiguous pages so navigation never skips an unloaded chapter.
          result = pages.slice(0, contiguousPages).flat();
          options.onProgress?.(result, first.total);
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, lastPage - 1) }, worker));
  return result;
}
