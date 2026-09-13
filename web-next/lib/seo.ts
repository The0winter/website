import type {Metadata} from 'next';

export const siteTitle = '九天小说站 - 热门小说 - 无弹窗 - 免费在线阅读 - 笔趣阁';
export const siteOrigin = (process.env.NEXT_PUBLIC_SITE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
export const privateRobots: Metadata['robots'] = {index: false, follow: false};

export function publicMetadata(title: string, description: string, path: string): Metadata {
  const url = siteOrigin + path;
  return {title, description, alternates: {canonical: url}, openGraph: {title, description, url, siteName: '九天小说站', locale: 'zh_CN', type: 'website'}};
}

export function plainDescription(value: string, fallback: string): string {
  const text = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, 160);
}
