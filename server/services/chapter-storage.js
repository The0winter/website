import {PutObjectCommand, GetObjectCommand} from '@aws-sdk/client-s3';
import {bodyHash, r2Client} from './r2.js';

export function createChapterStorage({client, bucket, maxCacheBytes = 16 * 1024 * 1024}) {
  const cache = new Map();
  let cacheBytes = 0;
  function remember(key, content) {
    if (cache.has(key)) return;
    const bytes = Buffer.byteLength(content);
    if (bytes > maxCacheBytes) return;
    while (cacheBytes + bytes > maxCacheBytes && cache.size) {
      const oldest = cache.keys().next().value;
      cacheBytes -= Buffer.byteLength(cache.get(oldest)); cache.delete(oldest);
    }
    cache.set(key, content); cacheBytes += bytes;
  }
  async function read(chapter, {fresh = false} = {}) {
    if (typeof chapter.content === 'string') return chapter.content;
    const {contentKey, contentSha256} = chapter;
    if (!/^[a-f0-9]{64}$/.test(contentSha256 || '') || contentKey !== `chapters/sha256/${contentSha256}.txt`) throw new Error('Invalid chapter storage reference');
    let content = fresh ? undefined : cache.get(contentKey);
    if (content === undefined) {
      const result = await client.send(new GetObjectCommand({Bucket:bucket,Key:contentKey}));
      if (result.ContentLength > 240000) throw new Error('Chapter object exceeds size limit');
      content = await result.Body.transformToString('utf-8');
      if (content.length > 60000 || bodyHash(content) !== contentSha256) throw new Error('Chapter body checksum mismatch');
      remember(contentKey, content);
    }
    return content;
  }
  async function write(content) {
    if (typeof content !== 'string' || !content.trim() || content.length > 60000) throw new Error('Invalid chapter body');
    const contentSha256 = bodyHash(content), contentKey = `chapters/sha256/${contentSha256}.txt`;
    const ref = {contentKey,contentSha256};
    // Content-addressed keys cannot change an existing chapter's bytes on a failed DB transaction.
    await client.send(new PutObjectCommand({Bucket:bucket,Key:contentKey,Body:content,ContentType:'text/plain; charset=utf-8',Metadata:{sha256:contentSha256}}));
    await read(ref, {fresh:true});
    return ref;
  }
  return {read,write};
}

let storage;
export const configureChapterStorage = adapter => {storage = adapter;};
const getStorage = () => storage ||= createChapterStorage({client:r2Client(),bucket:process.env.R2_BUCKET});
export const readChapterBody = chapter => typeof chapter.content === 'string' ? Promise.resolve(chapter.content) : getStorage().read(chapter);
export const storeChapterBody = content => getStorage().write(content);
export const chapterBodyMatches = (chapter, content) => typeof chapter.content === 'string' ? chapter.content === content : chapter.contentSha256 === bodyHash(content);
export async function chapterResponse(chapter) {
  const doc = chapter.toObject ? chapter.toObject() : {...chapter};
  doc.content = await readChapterBody(doc);
  delete doc.contentKey; delete doc.contentSha256;
  return {...doc,id:String(doc._id)};
}
