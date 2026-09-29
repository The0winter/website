import mongoose from 'mongoose';
import Author from '../models/Author.js';
import Book from '../models/Book.js';
import User from '../models/User.js';
import UsernameReservation from '../models/UsernameReservation.js';
import {authorIdentityKey,normalizeAuthorName} from './author-identity.js';
import {usernameKey} from './username-identity.js';

async function plan(session = null) {
  const authors=await Author.find().session(session).lean();
  const books=await Book.find({author_profile_id:{$exists:true},author_id:null}).select('author author_profile_id').session(session).lean();
  const users=await User.find().select('username').session(session).lean();
  const reservations=await UsernameReservation.find().select('_id').session(session).lean();
  const groups=new Map(),targets=new Map(),authorOps=[],bookOps=[];
  for(const author of authors){const key=authorIdentityKey(author);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(author);}
  let mergedGroups=0,aliases=0;
  for(const [identityKey,group] of groups){
    group.sort((a,b)=>String(a._id).localeCompare(String(b._id)));
    const canonical=group.find(a=>a.identityKey===identityKey&&!a.mergedInto)||group[0];
    const name=normalizeAuthorName(canonical.name);
    if(group.length>1)mergedGroups++;
    for(const author of group){
      targets.set(String(author._id),{id:canonical._id,name});
      if(String(author._id)===String(canonical._id))continue;
      aliases++;
      if(String(author.mergedInto)!==String(canonical._id)||author.identityKey){
        authorOps.push({updateOne:{filter:{_id:author._id},update:{$set:{mergedInto:canonical._id},$unset:{identityKey:1}}}});
      }
    }
    if(canonical.identityKey!==identityKey||canonical.name!==name||canonical.mergedInto){
      authorOps.push({updateOne:{filter:{_id:canonical._id},update:{$set:{identityKey,name},$unset:{mergedInto:1}}}});
    }
  }
  for(const book of books){
    const target=targets.get(String(book.author_profile_id));
    if(!target)throw new Error('Book references a missing imported author');
    if(normalizeAuthorName(book.author)!==target.name)throw new Error('Book author attribution differs from its profile');
    if(String(book.author_profile_id)!==String(target.id)||book.author!==target.name){
      bookOps.push({updateOne:{filter:{_id:book._id,author_id:null,author_profile_id:book.author_profile_id},update:{$set:{author_profile_id:target.id,author:target.name}}}});
    }
  }
  const reserved=new Set(reservations.map(r=>r._id));
  const keys=new Set(users.map(user=>usernameKey(user.username)));
  const reservationOps=[...keys].filter(key=>!reserved.has(key)).map(key=>({updateOne:{filter:{_id:key},update:{$setOnInsert:{reservedAt:new Date()}},upsert:true}}));
  return {authorOps,bookOps,reservationOps,summary:{authors:authors.length,canonicalAuthors:groups.size,mergedGroups,aliases,
    authorUpdates:authorOps.length,bookUpdates:bookOps.length,usernameReservations:reservationOps.length,legacyUsernameVariants:users.length-keys.size}};
}

export async function migrateIdentities({apply=false}={}) {
  if(!apply)return (await plan()).summary;
  await Author.createIndexes();
  await UsernameReservation.createCollection();
  let summary;
  await mongoose.connection.transaction(async session=>{
    const next=await plan(session);
    if(next.authorOps.length)await Author.bulkWrite(next.authorOps,{session});
    if(next.bookOps.length)await Book.bulkWrite(next.bookOps,{session});
    if(next.reservationOps.length)await UsernameReservation.bulkWrite(next.reservationOps,{session});
    summary=next.summary;
  });
  return summary;
}
