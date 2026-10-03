export const visibleForumReplies = {'curation.status': {$nin: ['withheld','duplicate']}};
export const forumSourceName = reply => reply.source?.kind === 'guide' ? '拾页整理' : reply.source?.author || reply.author?.username || '书友';
export const forumDisplayContent = reply => reply.curation?.status === 'withheld' ? '<p>这条书评的原文正在核对，暂不展示。</p>' : reply.content;
