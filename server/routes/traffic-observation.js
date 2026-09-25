import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import {createTrafficStore,validateTrafficEvent} from '../services/traffic-observation.js';
import {allowMetrics} from '../services/observability.js';

export function trafficObservationRoutes(app,config) {
  let store;
  const limiter=rateLimit({windowMs:60000,limit:240,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'统计上报过于频繁'}});
  // Installed after ordinary same-origin + CSRF protection. A failure never changes reading access.
  app.post('/api/traffic/observe',limiter,async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    if(allowMetrics(req))return res.status(204).end();
    if(config.trafficMode!=='observe'||mongoose.connection.transport)return res.status(204).end();
    let event;try{event=validateTrafficEvent(req.body);}catch{return res.status(400).json({error:'统计事件无效'});}
    try {
      store ||= createTrafficStore(mongoose.connection.db,config.jwtSecret);
      const secure=config.mode==='production',visitorName=secure?'__Host-traffic-visitor':'traffic-visitor',sessionName=secure?'__Host-traffic-session':'traffic-session';
      const result=await store.accept(event,{visitorCookie:req.cookies[visitorName],sessionCookie:req.cookies[sessionName],userAgent:req.headers['user-agent']});
      const options={httpOnly:true,secure,sameSite:'lax',path:'/'};
      res.cookie(visitorName,result.visitorCookie,{...options,maxAge:365*86400000});res.cookie(sessionName,result.sessionCookie,{...options,maxAge:30*60000});
      res.json({accepted:true,...(result.token?{token:result.token}:{})});
    }catch(error){const invalid=/Invalid|expired/.test(error.message);res.status(invalid?409:503).json({error:invalid?'统计会话已过期':'统计暂不可用'});}
  });
}
