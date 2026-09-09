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
  return globalThis.fetch(input, { ...init, headers, credentials: 'same-origin', signal: init?.signal || AbortSignal.timeout(15000) });
}

export async function catalogPages<T>(url: string): Promise<T[]> {
  const result: T[] = [];
  for (let page=1; ; page++) {
    const response=await safeFetch(`${url}${url.includes('?')?'&':'?'}page=${page}&limit=200`);
    if(!response.ok) throw new Error('目录暂不可用，请重试');
    const rows:T[]=await response.json();result.push(...rows);
    if(rows.length<200) return result;
  }
}
