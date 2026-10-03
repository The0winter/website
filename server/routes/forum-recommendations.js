import rateLimit from 'express-rate-limit';
import {asyncRoute} from '../security.js';
import {forumJson} from '../services/forum-json.js';
import {recommendationIdentity,personalizedForumFeed,recommendationPreferences,saveRecommendationPreference,
  removeRecommendationPreference,updateRecommendationSettings,recommendationReadReceipt,acceptRecommendationEvents,
  recordRecommendationEvent} from '../services/forum-recommendations.js';

export function forumRecommendationRoutes(app,auth,config) {
  const identity=async(req,res)=>recommendationIdentity(req,res,await auth.optionalUserId(req),config.jwtSecret);
  const limiter=rateLimit({windowMs:60000,limit:60,message:{error:'推荐操作过于频繁，请稍后再试'}});
  const feedLimiter=rateLimit({windowMs:60000,limit:60,message:{error:'刷新过于频繁，请稍后再试'}});
  app.use('/api/forum/posts',(req,res,next)=>req.method==='GET' && req.path==='/' && req.query.format==='page' && !req.query.cursor?feedLimiter(req,res,next):next());
  app.locals.forumRecommendations={
    feed:async(req,res,options)=>personalizedForumFeed({...options,identity:await identity(req,res),key:config.jwtSecret}),
    // Business writes succeed even when optional recommendation telemetry fails.
    action:async(req,res,entry,event)=>{
      try {await recordRecommendationEvent(recommendationIdentity(req,res,req.user.id,config.jwtSecret),entry,event);}
      catch {console.error('Forum recommendation interaction unavailable');}
    },
  };
  app.get('/api/forum/preferences',asyncRoute(async(req,res)=>{
    const actor=(await identity(req,res)).actor;await forumJson(req,res,await recommendationPreferences(actor));
  }));
  app.post('/api/forum/preferences',limiter,asyncRoute(async(req,res)=>{
    const actor=(await identity(req,res)).actor;
    if(req.body.action==='import') {
      if(!Array.isArray(req.body.rows)||req.body.rows.length>100)return res.status(400).json({error:'旧偏好批次无效'});
      for(const row of req.body.rows) {
        try {await saveRecommendationPreference(actor,row.entry,row.reason);}
        catch(error){if(error.status!==404)throw error;}
      }
      return res.json(await recommendationPreferences(actor));
    }
    res.json(await saveRecommendationPreference(actor,req.body.entry,req.body.reason));
  }));
  app.delete('/api/forum/preferences/:preferenceKey',limiter,asyncRoute(async(req,res)=>{
    res.json(await removeRecommendationPreference((await identity(req,res)).actor,req.params.preferenceKey));
  }));
  app.patch('/api/forum/preferences',limiter,asyncRoute(async(req,res)=>{
    res.json(await updateRecommendationSettings((await identity(req,res)).actor,req.body));
  }));
  app.get('/api/forum/recommendations/receipt',limiter,asyncRoute(async(req,res)=>{
    res.json(await recommendationReadReceipt((await identity(req,res)).actor,req.query.entry,config.jwtSecret));
  }));
  app.post('/api/forum/recommendations/events',limiter,asyncRoute(async(req,res)=>{
    res.json(await acceptRecommendationEvents(await identity(req,res),req.body.events,config.jwtSecret));
  }));
}
