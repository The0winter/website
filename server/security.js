import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { doubleCsrf } from 'csrf-csrf';
import sanitizeHtml from 'sanitize-html';
import User from './models/User.js';
import Session from './models/Session.js';

export const safeHtml = value => sanitizeHtml(typeof value === 'string' ? value : '', {
  allowedTags: ['p','br','strong','b','em','i','u','s','blockquote','pre','code','ul','ol','li','h2','h3','a'],
  allowedAttributes: { a: ['href','title'] }, allowedSchemes: ['https','http','mailto'], allowProtocolRelative: false,
});
export const publicUser = u => ({ id: String(u._id), _id: String(u._id), username: u.username, avatar: u.avatar, role: u.role === 'admin' ? 'admin' : 'reader', created_at: u.created_at });
export const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
export function security(app, config) {
  const secure = config.mode === 'production';
  const cookieName = secure ? '__Host-session' : 'session';
  const cookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
  app.use(cookieParser());
  const csrf = doubleCsrf({ getSecret: () => config.jwtSecret, getSessionIdentifier: req => req.cookies[cookieName] || 'anonymous', cookieName: secure ? '__Host-csrf' : 'csrf', cookieOptions, getCsrfTokenFromRequest: req => req.headers['x-csrf-token'] });
  app.get('/api/auth/csrf', (req,res) => { res.set('Cache-Control','no-store'); res.json({ csrfToken: csrf.generateCsrfToken(req,res) }); });
  app.use('/api', (req,res,next) => {
    if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
    // Dedicated script routes use their own credential and cannot act as a browser session.
    if (['/admin/check-sync','/admin/upload-book'].includes(req.path) && !req.headers.origin && !req.cookies[cookieName]) return next();
    if (!config.origins.includes(req.headers.origin)) return res.status(403).json({error:'请求来源无效'});
    csrf.doubleCsrfProtection(req,res,next);
  });
  const authenticate = asyncRoute(async (req,res,next) => {
    try {
      const token = req.cookies[cookieName];
      if (!token) return res.status(401).json({error:'请先登录'});
      const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      const session = await Session.findOne({_id:payload.sid, userId:payload.id, expiresAt:{$gt:new Date()}});
      if (!session) return res.status(401).json({error:'登录已失效'});
      const user = await User.findById(session.userId);
      if (!user || user.isBanned || (user.authVersion||0)!==(session.authVersion||0)) return res.status(403).json({error:'账户不可用'});
      req.user = {id:String(user._id),role:user.role === 'admin' ? 'admin' : 'reader'};
      req.account = user;
      req.sessionId = session._id;
      next();
    } catch (e) {
      if (e instanceof jwt.JsonWebTokenError || e instanceof jwt.TokenExpiredError) return res.status(401).json({error:'登录已失效'});
      throw e;
    }
  });
  async function issue(res,user,session) {
    const sid = crypto.randomBytes(32).toString('hex');
    const seconds = user.role === 'admin' ? 43200 : 604800;
    await Session.create([{_id:sid,userId:user._id,authVersion:user.authVersion||0,expiresAt:new Date(Date.now()+seconds*1000)}], session ? {session} : {});
    const token = jwt.sign({id:String(user._id),sid},config.jwtSecret,{expiresIn:seconds,algorithm:'HS256'});
    res.cookie(cookieName,token,{...cookieOptions,maxAge:seconds*1000});
  }
  return { authenticate, issue, clear: res => res.clearCookie(cookieName,cookieOptions) };
}
