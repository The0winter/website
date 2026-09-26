import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { doubleCsrf } from 'csrf-csrf';
import sanitizeHtml from 'sanitize-html';
import User from './models/User.js';
import Session from './models/Session.js';

export const SESSION_IDLE_MS = 3 * 24 * 60 * 60 * 1000;
export const SESSION_REFRESH_MS = 5 * 60 * 1000;

export const safeHtml = value => sanitizeHtml(typeof value === 'string' ? value : '', {
  allowedTags: ['p','br','strong','b','em','i','u','s','blockquote','pre','code','ul','ol','li','h2','h3','a'],
  allowedAttributes: { a: ['href','title'] }, allowedSchemes: ['https','http','mailto'], allowProtocolRelative: false,
});
export const publicUser = u => ({ id: String(u._id), _id: String(u._id), username: u.username, avatar: u.avatar, profileTheme: u.profileTheme, role: u.role === 'admin' ? 'admin' : 'reader', created_at: u.created_at, ...(u.isTestAccount ? {isTestAccount:true} : {}) });
export const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
export function security(app, config) {
  const secure = config.mode === 'production';
  const cookieName = secure ? '__Host-session' : 'session';
  const cookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
  app.use(cookieParser());
  // Renewal changes the JWT, but not the session identity. Concurrent writes
  // and other tabs must keep valid CSRF tokens across a renewal.
  const csrf = doubleCsrf({ getSecret: () => config.jwtSecret, getSessionIdentifier: req => {
    const sid = jwt.decode(req.cookies[cookieName] || '')?.sid;
    return typeof sid === 'string' && /^[a-f0-9]{64}$/.test(sid) ? sid : 'anonymous';
  }, cookieName: secure ? '__Host-csrf' : 'csrf', cookieOptions, getCsrfTokenFromRequest: req => req.headers['x-csrf-token'] });
  app.get('/api/auth/csrf', (req,res) => { res.set('Cache-Control','no-store'); res.json({ csrfToken: csrf.generateCsrfToken(req,res) }); });
  app.use('/api', (req,res,next) => {
    if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
    // Dedicated script routes use their own credential and cannot act as a browser session.
    if (['/admin/check-sync','/admin/upload-book'].includes(req.path) && !req.headers.origin && !req.cookies[cookieName]) return next();
    if (!config.origins.includes(req.headers.origin)) return res.status(403).json({error:'请求来源无效'});
    csrf.doubleCsrfProtection(req,res,next);
  });
  async function resolveSession(req) {
    const token = req.cookies[cookieName];
    if (!token) return null;
    let payload;
    try { payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }); }
    catch (e) { if (e instanceof jwt.JsonWebTokenError) return null; throw e; }
    if (typeof payload !== 'object' || typeof payload.sid !== 'string' || !/^[a-f0-9]{64}$/.test(payload.sid) || !/^[a-f0-9]{24}$/i.test(payload.id)) return null;
    const session = await Session.findOne({_id:payload.sid,userId:payload.id,expiresAt:{$gt:new Date(Date.now())}});
    if (!session) return null;
    const user = await User.findById(session.userId);
    if (!user || user.isBanned || user.isTestAccount || (user.authVersion||0)!==(session.authVersion||0)) return null;
    return {session,user};
  }
  const authenticate = asyncRoute(async (req,res,next) => {
    try {
      const resolved = await resolveSession(req);
      if (!resolved) return res.status(401).json({error:'登录已失效'});
      const {session,user} = resolved;
      req.user = {id:String(user._id),role:user.role === 'admin' ? 'admin' : 'reader'};
      req.account = user;
      req.sessionId = session._id;
      req.authSession = session;
      next();
    } catch (e) {
      if (e instanceof jwt.JsonWebTokenError || e instanceof jwt.TokenExpiredError) return res.status(401).json({error:'登录已失效'});
      throw e;
    }
  });
  function setSessionCookie(res, userId, sid, expiresAt) {
    const expires = Math.floor(+expiresAt / 1000);
    const token = jwt.sign({id:String(userId),sid,exp:expires},config.jwtSecret,{algorithm:'HS256'});
    res.cookie(cookieName,token,{...cookieOptions,maxAge:Math.max(0,expires*1000-Date.now())});
  }
  const renewals = new Map();
  async function renew(req,res) {
    const now = Date.now(), session = req.authSession;
    // Reads, prefetches and background jobs never extend a session. The browser
    // reports actual activity at most once per five minutes across its tabs.
    // No auth cache: password changes, bans and logout still revoke immediately.
    if (session.lastActiveAt && +session.lastActiveAt > now - SESSION_REFRESH_MS) {
      setSessionCookie(res,session.userId,session._id,session.expiresAt);
      return {expiresAt:session.expiresAt};
    }
    let renewal = renewals.get(session._id);
    if (!renewal) {
      renewal = (async () => {
        const expiresAt = new Date(now + SESSION_IDLE_MS);
        const result = await Session.updateOne({_id:session._id,userId:session.userId,
          authVersion:session.authVersion,expiresAt:{$gt:new Date(now)},
          $or:[{lastActiveAt:{$exists:false}},{lastActiveAt:{$lte:new Date(now-SESSION_REFRESH_MS)}}]},
          {$set:{lastActiveAt:new Date(now),expiresAt}});
        // Never upsert: a racing logout, expiry or password change cannot be undone.
        return result.modifiedCount ? expiresAt : null;
      })().finally(() => renewals.delete(session._id));
      renewals.set(session._id,renewal);
    }
    const expiresAt = await renewal;
    if (expiresAt) setSessionCookie(res,session.userId,session._id,expiresAt);
    return {expiresAt:expiresAt || session.expiresAt};
  }
  async function issue(res,user,session) {
    const sid = crypto.randomBytes(32).toString('hex');
    const now = Date.now(), expiresAt = new Date(now + SESSION_IDLE_MS);
    await Session.create([{_id:sid,userId:user._id,authVersion:user.authVersion||0,lastActiveAt:new Date(now),expiresAt}], session ? {session} : {});
    setSessionCookie(res,user._id,sid,expiresAt);
  }
  return { authenticate, issue, renew, optionalUserId: async req => { const resolved = await resolveSession(req); return resolved ? String(resolved.user._id) : null; }, clear: res => res.clearCookie(cookieName,cookieOptions) };
}
