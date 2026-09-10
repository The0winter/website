import crypto from 'node:crypto';
import {fail} from './content.js';

export function importMetadata(data) {
  const url = value => {
    try { const u=new URL(value); if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.href.length>2000)throw Error();u.hash='';return u.href; }
    catch {fail(400,'来源或封面网址无效');}
  };
  const sourceUrl=url(data.sourceUrl);
  const name=typeof data.author==='string'?data.author.normalize('NFKC').trim():'未知';
  if(!name||name.length>200)fail(400,'作者名无效');
  const authorUrl=data.authorSourceUrl===undefined?undefined:url(data.authorSourceUrl);
  // Without an author URL, keep identities separate per book; names alone aren't identity.
  const sourceKey=crypto.createHash('sha256').update(authorUrl||`${sourceUrl}\0${name}`).digest('hex');
  const metadata={};
  for(const [field,max] of [['description',5000],['category',80]])if(data[field]!==undefined){if(typeof data[field]!=='string'||data[field].length>max)fail(400,'书籍元数据无效');metadata[field]=data[field];}
  if(data.status!==undefined){if(!['连载','完结'].includes(data.status))fail(400,'完结状态无效');metadata.status=data.status;}
  if(data.cover_image!==undefined)metadata.cover_image=data.cover_image===''?'':url(data.cover_image);
  return {author:{sourceKey,name,sourceUrl:authorUrl},metadata};
}
