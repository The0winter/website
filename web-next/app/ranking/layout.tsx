import {publicMetadata} from '@/lib/seo';
export const metadata = publicMetadata('小说排行榜 - 日榜、周榜与热门作品 - 九天小说站', '查看九天小说站的小说日榜、周榜、月榜与总榜，按分类发现读者正在阅读的热门作品。', '/ranking');
export default function RankingLayout({children}: {children: React.ReactNode}) { return children; }
