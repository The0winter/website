import type {ForumSource} from '@/lib/api';

export default function ForumSourceCredit({source}: {source?: ForumSource}) {
  if (!source) return null;
  return <aside className="forum-source-credit" aria-label="文章来源与许可">
    <span>原作者：{source.author}</span>
    <a href={source.url} target="_blank" rel="noopener noreferrer">查看原文 ↗</a>
    <a href={source.licenseUrl} target="_blank" rel="noopener noreferrer">{source.license}</a>
    <p>依原文许可收录，保留全文与署名，仅调整显示格式。</p>
  </aside>;
}
