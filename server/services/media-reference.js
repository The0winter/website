import Media from '../models/Media.js';

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
  return filter && Media.findOneAndUpdate(filter,{$inc:{referenceVersion:1}},{session});
}
