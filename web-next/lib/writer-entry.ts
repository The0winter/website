// Old bookmarks open the current workspace; they never mount a second editor.
export function writerEntry(entry: string) {
  const params = new URLSearchParams(entry);
  const action = params.get('action');
  const reference = action === 'chapters' ? params.get('work') || ''
    : action === 'new' && params.has('draft') ? `m_${params.get('draft')}`
    : ['manage', 'write'].includes(action || '') && params.has('book') ? `b_${params.get('book')}` : '';
  return {reference, kind: reference ? 'chapters' : action === 'new' ? 'new' : action === 'statistics' ? 'statistics' : 'works'};
}
