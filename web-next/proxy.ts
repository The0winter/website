import {NextRequest, NextResponse} from 'next/server';
import {safeFetch} from '@/lib/request';
import {getApiBaseUrl} from '@/utils/api';

function unavailable(status: 404 | 503) {
  const title = status === 404 ? '页面未找到' : '页面暂时无法打开';
  const detail = status === 404 ? '这个链接对应的内容不存在或已下线。' : '服务暂时不可用，请稍后重试。';
  return new NextResponse(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} - 九天小说站</title></head><body style="font-family:system-ui,sans-serif;margin:0"><main style="max-width:36rem;margin:18vh auto;padding:2rem;text-align:center"><h1>${title}</h1><p>${detail}</p><a href="/">返回九天小说站首页</a></main></body></html>`, {status, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...(status === 503 ? {'Retry-After': '60'} : {})}});
}

// App Router's loading boundaries may stream HTTP 200 before notFound resolves.
// Validate document requests before streaming; SPA/prefetch requests keep their
// existing fast navigation path. Chapter checks read catalog metadata, never R2.
export async function proxy(request: NextRequest) {
  if (!['GET', 'HEAD'].includes(request.method) || request.headers.get('rsc') === '1') return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (path === '/forum/create') return NextResponse.next();
  const match = /^\/(book|author|forum)(?:\/(question))?\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (!match) return NextResponse.next();
  const [, kind, question, id, chapter] = match;
  if (!/^[a-f0-9]{24}$/i.test(id) || (chapter && !/^[a-f0-9]{24}$/i.test(chapter)) || (question && kind !== 'forum') || (chapter && kind !== 'book')) return unavailable(404);
  const parent = kind === 'forum' && !question ? request.nextUrl.searchParams.get('fromQuestion') : null;
  const answerParent = parent && parent !== 'undefined' ? parent : null;
  if (answerParent && (!/^[a-f0-9]{24}$/i.test(answerParent) || request.nextUrl.searchParams.getAll('fromQuestion').length !== 1)) return unavailable(404);
  const endpoint = kind === 'book' ? chapter ? `/books/${id}/catalog?anchor=${chapter}&limit=1` : `/books/${id}` : kind === 'author' ? `/authors/${id}` : answerParent ? `/forum/posts/${answerParent}/replies?target=${id}` : `/forum/posts/${id}`;
  try {
    const response = await safeFetch(getApiBaseUrl() + endpoint, {cache: 'no-store'});
    if (response.status === 404) return unavailable(404);
    if (!response.ok) return unavailable(503);
    if (answerParent) {
      const replies = await response.json();
      if (!Array.isArray(replies) || !replies.some((reply: {id: string}) => reply.id?.toLowerCase() === id.toLowerCase())) return unavailable(404);
    }
    if (chapter) {
      const catalog = await response.json();
      if (catalog.activeIndex === null || !catalog.rows?.some((row: {id: string}) => row.id.toLowerCase() === chapter.toLowerCase())) return unavailable(404);
    }
    return NextResponse.next();
  } catch { return unavailable(503); }
}

export const config = {matcher: ['/book/:path*', '/author/:path*', '/forum/:path*']};
