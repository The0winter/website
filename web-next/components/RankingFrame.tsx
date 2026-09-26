import type {MouseEvent, ReactNode, Ref} from 'react';
import {ArrowLeft, ChevronRight} from 'lucide-react';
import '../app/ranking/ranking.css';

export const RANKS = [
  {id: 'day', name: '日榜', sort: 'rank_day', period: '今日'},
  {id: 'week', name: '周榜', sort: 'rank_week', period: '本周'},
  {id: 'month', name: '月榜', sort: 'rank_month', period: '本月'},
  {id: 'total', name: '总榜', sort: 'rank_total', period: '累计'},
  {id: 'views', name: '浏览榜', sort: 'views', period: '累计'},
] as const;
export type RankId = typeof RANKS[number]['id'];
const CATEGORIES = ['全部', '玄幻', '仙侠', '都市', '历史', '科幻', '奇幻', '悬疑', '轻小说', '诸天无限', '游戏', '体育', '军事', '武侠', '现实', '言情', '文学'];

export function RankingSkeleton() {
  return <div className="ranking-loading" role="status" aria-label="正在加载排行榜">
    {Array.from({length: 7}, (_, i) => <div className="ranking-skeleton" key={i} aria-hidden="true"><i/><div><i/><i/><i/></div></div>)}
  </div>;
}

// The pre-mounted entry frame and the real route share exactly the same layout.
export default function RankingFrame({activeRank = 'day', category = '全部', categoriesRef, onCategory, onRank, back, busy = true, children}: {
  activeRank?: string; category?: string; categoriesRef?: Ref<HTMLElement>;
  onCategory?: (name: string, event: MouseEvent<HTMLButtonElement>) => void;
  onRank?: (id: RankId) => void; back?: ReactNode; busy?: boolean; children?: ReactNode;
}) {
  const rank = RANKS.find(item => item.id === activeRank) ?? RANKS[0];
  return <div className="ranking-page"><div className="ranking-shell">
    <header className="ranking-header">
      <div className="ranking-titlebar">
        {back ?? <button type="button" className="ranking-back" aria-label="返回首页"><ArrowLeft size={21}/></button>}
        <h1 className="ranking-title">排行榜<span>发现值得读的故事</span></h1>
      </div>
      <nav ref={categoriesRef} className="ranking-categories" aria-label="小说分类">
        {CATEGORIES.map(name => <button key={name} type="button" aria-pressed={category === name} onClick={event => onCategory?.(name, event)}>{name}</button>)}
      </nav>
    </header>
    <div className="ranking-layout">
      <aside className="ranking-sidebar"><nav className="ranking-nav" aria-label="榜单切换">
        {RANKS.map(item => <button key={item.id} type="button" aria-pressed={activeRank === item.id} onClick={() => onRank?.(item.id)}>
          <span>{item.name}</span><ChevronRight size={15} aria-hidden="true"/>
        </button>)}
      </nav></aside>
      <section className="ranking-content" aria-label={`${category}${rank.name}`} aria-busy={busy}>{children ?? <RankingSkeleton/>}</section>
    </div>
  </div></div>;
}
