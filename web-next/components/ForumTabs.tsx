'use client';

export type FeedTab = 'recommend' | 'hot' | 'follow';
export const FORUM_TABS: Array<{id: FeedTab; label: string}> = [
  {id: 'recommend', label: '推荐'}, {id: 'hot', label: '热榜'}, {id: 'follow', label: '关注'},
];

export default function ForumTabs({activeTab = 'recommend', onSelect}: {activeTab?: FeedTab; onSelect?: (tab: FeedTab) => void}) {
  return <div className="forum-feed-toolbar bg-[var(--home-surface)] border-[var(--home-border)]">
    <nav aria-label="论坛内容分类" className="-mb-px flex flex-1 min-w-0 justify-around md:justify-start items-center md:gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {FORUM_TABS.map(tab => <button key={tab.id} aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => onSelect?.(tab.id)}
        className={`flex-1 md:flex-none flex justify-center items-center shrink-0 px-3 sm:px-4 h-11 border-b-2 text-[15px] font-semibold transition-colors ${activeTab === tab.id ? 'text-[var(--home-accent)] border-[var(--home-accent)]' : 'text-[var(--home-muted)] border-transparent hover:text-[var(--home-text)]'}`}>
        {tab.label}
      </button>)}
    </nav>
  </div>;
}
