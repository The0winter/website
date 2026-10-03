import type {ForumSource} from '@/lib/api';

export default function ForumSourceCredit({source}: {source?: ForumSource}) {
  if (!source) return null;
  return <aside className="forum-source-credit" aria-label="文章来源与许可">
    <span>{source.kind === 'guide' ? '参考原文作者' : '原作者'}：{source.author}</span>
    <a href={source.url} target="_blank" rel="noopener noreferrer">查看原文 ↗</a>
    {source.alternates?.length ? <p>相同内容的其他收录：{source.alternates.map(item => <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer">{item.author} ↗ </a>)}</p> : null}
    {source.kind === 'guide' ? <p>整理者导读，概述原文观点，并非原作者全文。</p> : source.kind === 'excerpt' ? <p>原文节选，保留所录段落与署名；完整内容请查看原文。</p> : source.license && source.licenseUrl ? <>
      <a href={source.licenseUrl} target="_blank" rel="noopener noreferrer">{source.license}</a>
      <p>依原文许可收录，保留全文与署名，仅调整显示格式。</p>
    </> : <p>收录书评，保留原作者署名与原文链接。</p>}
  </aside>;
}
