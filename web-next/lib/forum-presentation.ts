import type {ForumPost, ForumReply} from './api';

export function forumEntryHref(post: ForumPost) {
  if (post.type === 'article') return `/forum/${post.id}`;
  return post.topReply?.id ? `/forum/${post.topReply.id}?fromQuestion=${post.id}` : `/forum/question/${post.id}`;
}
export function plainForumText(content: string) {
  return content.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
export function textToForumHtml(content: string) {
  return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
}
export function answerFeedItem(question: ForumPost, answer: ForumReply): ForumPost {
  return {...question, entryId:answer.id, topReply:{...answer, excerpt:plainForumText(answer.content).slice(0, 200)}};
}
