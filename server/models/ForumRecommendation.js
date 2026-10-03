import mongoose from 'mongoose';

const model = (name, fields, indexes = []) => {
  const schema = new mongoose.Schema({_id:String, ...fields}, {versionKey:false});
  for (const [keys, options] of indexes) schema.index(keys, options);
  return mongoose.models[name] || mongoose.model(name, schema);
};

// Derived metadata only; original posts, answers and book permissions remain authoritative.
export const RecommendationItem = model('ForumRecommendationItem', {
  post:String, book:String, author:String, authorName:String, bookAuthor:String,
  topic:String, topics:[String], terms:[String], fingerprint:String, nearSignature:String, bucket:Number,
  kind:String, length:Number, quality:Number, publishedAt:Date, createdAt:Date,
  indexedAt:Date, sourceUpdatedAt:Date, item:mongoose.Schema.Types.Mixed,
}, [[{createdAt:-1,_id:1}], [{quality:-1,_id:1}], [{book:1,quality:-1}],
  [{topic:1,quality:-1}], [{bucket:1,quality:-1}], [{author:1}], [{post:1}]]);

export const RecommendationCheckpoint = model('ForumRecommendationCheckpoint', {at:Date, key:String, passAt:Date});
export const RecommendationProfile = model('ForumRecommendationProfile', {
  enabled:{type:Boolean,default:true}, exploration:{type:String,default:'balanced'}, resetAt:Date,
});
export const RecommendationPreference = model('ForumRecommendationPreference', {
  actor:String, entry:String, question:String, book:String, topic:String, author:String,
  authorName:String, title:String, text:String, reason:String, createdAt:Date,
}, [[{actor:1,createdAt:-1}]]);

export const RecommendationEvent = model('ForumRecommendationEvent', {
  actor:String, entry:String, day:String, book:String, author:String, topic:String, topics:[String],
  impression:Boolean, read:Boolean, like:Boolean, comment:Boolean, at:Date, expiresAt:Date,
}, [[{actor:1,at:-1}], [{actor:1,entry:1,at:-1}], [{entry:1,at:-1}], [{expiresAt:1},{expireAfterSeconds:0}]]);

export const RecommendationTrend = model('ForumRecommendationTrend', {
  heat24:{type:Number,default:0}, heat7:{type:Number,default:0},
  exposures:{type:Number,default:0}, reads:{type:Number,default:0}, likes:{type:Number,default:0},
  at:Date, expiresAt:Date,
}, [[{at:-1,heat24:-1}], [{heat24:-1}], [{expiresAt:1},{expireAfterSeconds:0}]]);

export const RecommendationSession = model('ForumRecommendationSession', {
  actor:String, tab:String, entries:[String], reasons:[String], createdAt:Date, expiresAt:Date,
}, [[{expiresAt:1},{expireAfterSeconds:0}], [{actor:1,createdAt:-1}]]);

export const recommendationModels = [RecommendationItem, RecommendationCheckpoint, RecommendationProfile,
  RecommendationPreference, RecommendationEvent, RecommendationTrend, RecommendationSession];
