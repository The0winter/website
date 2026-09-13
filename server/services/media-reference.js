import Media from '../models/Media.js';
import Book from '../models/Book.js';
import User from '../models/User.js';
import Manuscript from '../models/Manuscript.js';

export function mediaUrls(media) {
  const urls=[`/api/media/${media._id}`];
  if(media.publicUrl) urls.push(media.publicUrl,media.publicUrl.replace(/\/480\.webp$/,'/240.webp'));
  return [...new Set(urls)];
}
export async function hasMediaReferences(media,session) {
  const urls=mediaUrls(media);
  // Include removed books: restoring a book must keep its original cover working.
  return !!(await Book.exists({cover_image:{$in:urls}}).session(session) || await User.exists({avatar:{$in:urls}}).session(session) || await Manuscript.exists({cover_image:{$in:urls},publishedBookId:null}).session(session));
}

export function mediaFilter(url, owner) {
  if (typeof url !== 'string') return null;
  const legacy = /^\/api\/media\/([a-f0-9]{24})$/.exec(url);
  if (legacy) return {_id:legacy[1],owner,deleted:false};
  // An exact stored URL is required; a matching hostname alone never proves ownership.
  if (/^https:\/\/[^/]+\/covers\/[a-f0-9]{24}\/480\.webp$/.test(url)) return {publicUrl:url,storage:'r2',owner,deleted:false};
  return null;
}
export async function claimMedia(url, owner, session) {
  const filter = mediaFilter(url,owner);
  return filter && Media.findOneAndUpdate({...filter,purgeStartedAt:null,purgedAt:null},{$inc:{referenceVersion:1},$set:{unreferencedSince:null}},{session});
}

// Call inside the same transaction, after saving the book's new cover.
export async function retireUnreferencedCover(url,session,now=new Date()) {
  const match=typeof url==='string' && /^\/api\/media\/([a-f0-9]{24})$/.exec(url);
  if(!url)return;
  const media=await Media.findOneAndUpdate({storage:'r2',purgeStartedAt:null,purgedAt:null,...(match?{_id:match[1]}:{publicUrl:url})},{$inc:{referenceVersion:1}},{new:true,session});
  if(!media)return;
  if(await hasMediaReferences(media,session))media.unreferencedSince=null;
  else media.unreferencedSince ||= now;
  await media.save({session});
  return media.unreferencedSince?String(media._id):undefined;
}

// Imports can use external covers, but must also lock registered R2 covers before reuse.
export async function claimImportedCover(url,session) {
  if(!url)return;
  const known=await Media.findOne({storage:'r2',publicUrl:url}).session(session);
  if(!known){
    if(process.env.COVER_PUBLIC_BASE_URL && url.startsWith(process.env.COVER_PUBLIC_BASE_URL+'/covers/'))throw Object.assign(Error('封面未登记或已清理，请重新上传'),{status:400});
    return;
  }
  if(!await claimMedia(url,known.owner,session))throw Object.assign(Error('封面已移除或正在清理，请重新上传'),{status:400});
}
