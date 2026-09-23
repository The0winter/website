import type {Metadata} from 'next';
import type {Book, Chapter} from './api';

export const siteName = '九天小说站';
export const siteTitle = '九天小说站 - 热门小说免费在线阅读 - 笔趣阁';
export const siteDescription = '九天小说站提供小说免费在线阅读、作品介绍和章节目录，通过热门推荐、小说排行榜与最近更新发现好书。';
export const siteOrigin = (process.env.NEXT_PUBLIC_SITE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
export const privateRobots: Metadata['robots'] = {index: false, follow: false};

export function publicMetadata(title: string, description: string, path: string): Metadata {
  const url = siteOrigin + path;
  return {title, description, alternates: {canonical: url}, openGraph: {title, description, url, siteName, locale: 'zh_CN', type: 'website'}};
}

export function plainDescription(value: string, fallback: string): string {
  const text = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, 160);
}

export function bookPageTitle(book: Pick<Book, 'title' | 'author'>): string {
  return [book.title.trim(), book.author?.trim(), '在线免费阅读'].filter(Boolean).join('_') + ' - 九天小说站';
}

export function bookDescription(book: Pick<Book, 'title' | 'author' | 'description'>): string {
  const author = book.author?.trim();
  const introduction = `《${book.title.trim()}》${author ? `，作者：${author}` : ''}。提供小说介绍、章节目录和在线免费阅读。`;
  return plainDescription(`${introduction}${book.description || ''}`, introduction);
}

export function chapterHeading(chapter: Pick<Chapter, 'title' | 'chapter_number'>): string {
  const title = chapter.title?.trim();
  if (!title) return '章节阅读';
  return title.startsWith('第') ? title : `第${chapter.chapter_number}章 ${title}`;
}

// The reader changes chapters without a full navigation; keep its browser title
// identical to the title generated on the server for a direct chapter visit.
export function chapterPageTitle(book: Pick<Book, 'title'>, chapter: Pick<Chapter, 'title' | 'chapter_number'>): string {
  return `${chapterHeading(chapter)} - ${book.title.trim()} - 九天小说站`;
}
