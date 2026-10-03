import rateLimit from 'express-rate-limit';
import {authRoutes} from './auth.js';
import {asyncRoute} from '../security.js';
import NativeSession from '../models/NativeSession.js';

export function nativeAuthRoutes(app, auth, config) {
  const prefix = '/api/v1/auth';
  // Independent IP budget, including refresh, on top of the shared API limiter.
  app.use(prefix, rateLimit({windowMs: 60000, limit: 20, message: {code: 'RATE_LIMITED', error: '操作太频繁，请稍后重试'}}));
  app.use(prefix, (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    const json = res.json.bind(res);
    res.json = value => json(res.statusCode >= 400 && value?.error && !value.code
      ? {...value, code: ({400:'INVALID_INPUT',401:'LOGIN_FAILED',403:'ACCOUNT_UNAVAILABLE',409:'CONFLICT',429:'RATE_LIMITED',503:'SERVICE_UNAVAILABLE'})[res.statusCode] || 'REQUEST_FAILED'} : value);
    if (['/login','/signup','/register'].includes(req.path) && req.method === 'POST' && req.body.deviceName !== undefined &&
      (typeof req.body.deviceName !== 'string' || !req.body.deviceName.trim() || req.body.deviceName.length > 80)) {
      return res.status(400).json({error: '设备名称须为 1–80 个字符'});
    }
    next();
  });
  const native = {...auth,
    issue: (res, user) => auth.native.issue(user, res.req.body.deviceName?.trim() || 'Android'),
    clear: () => {}, revoke: auth.native.revoke,
  };
  authRoutes(app, native, config, {prefix, native: true});
  app.post(`${prefix}/refresh`, asyncRoute(async (req, res) => res.json(await auth.native.refresh(req.body.refreshToken))));
  app.get(`${prefix}/sessions`, auth.authenticate, asyncRoute(async (req, res) => {
    const sessions = await NativeSession.find({userId: req.user.id, revokedAt: null, expiresAt: {$gt: new Date()}})
      .select('_id deviceName createdAt lastUsedAt expiresAt authVersion').sort({createdAt: -1}).limit(100).lean();
    res.json({sessions: sessions.filter(session => session.authVersion === (req.account.authVersion || 0)).map(session => ({
      id: session._id, deviceName: session.deviceName, createdAt: session.createdAt, lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt, current: session._id === req.sessionId,
    }))});
  }));
  app.delete(`${prefix}/sessions/:sessionId`, auth.authenticate, asyncRoute(async (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.sessionId)) return res.status(400).json({code:'INVALID_INPUT', error:'设备会话编号无效'});
    const target = await NativeSession.findOne({_id: req.params.sessionId, userId: req.user.id});
    if (!target) return res.status(404).json({code:'SESSION_NOT_FOUND', error:'设备会话不存在'});
    await auth.native.revoke(target._id, 'user_revoked');
    res.json({success: true});
  }));
  app.use(prefix, (error, req, res, next) => {
    if (!error.status) return next(error);
    res.status(error.status).json({code: typeof error.code === 'string' ? error.code : 'REQUEST_FAILED', error: error.message});
  });
}
