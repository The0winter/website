import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import NativeSession from '../models/NativeSession.js';

export const ACCESS_SECONDS = 600;
export const REFRESH_MS = 30 * 86400000;
const issuer = 'jiutian-native', audience = 'jiutian-android';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const failure = (code, message, status = 401) => Object.assign(new Error(message), {status, code});

// Browser requests never acquire the native CSRF exception, even with a valid token.
export function nativeContext(req) {
  return !req.headers.origin && !req.headers.cookie && !req.headers['sec-fetch-site'];
}

export function createNativeAuth(config) {
  const key = crypto.createHmac('sha256', config.jwtSecret).update('native-refresh-v1').digest();
  const signature = value => crypto.createHmac('sha256', key).update(value).digest('hex');
  function refreshToken(sid) {
    const value = `${sid}.${crypto.randomBytes(32).toString('hex')}`;
    return `${value}.${signature(value)}`;
  }
  function parseRefresh(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(value)) throw failure('REFRESH_INVALID', '刷新令牌无效');
    const [sid, nonce, mac] = value.split('.');
    if (!crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(signature(`${sid}.${nonce}`), 'hex'))) throw failure('REFRESH_INVALID', '刷新令牌无效');
    return sid;
  }
  async function account(session) {
    const user = await User.findById(session.userId);
    if (!user || user.isBanned || user.isTestAccount || (user.authVersion || 0) !== session.authVersion) {
      await revoke(session._id, 'account_changed');
      throw failure('SESSION_REVOKED', '账户状态已变更，请重新登录');
    }
    return user;
  }
  function tokens(session, user, refresh) {
    const expires = Math.floor(Date.now() / 1000) + ACCESS_SECONDS;
    return {tokenType: 'Bearer', accessToken: jwt.sign({sub: String(user._id), sid: session._id, av: session.authVersion, typ: 'native_access', exp: expires}, config.jwtSecret, {algorithm: 'HS256', issuer, audience}),
      expiresIn: ACCESS_SECONDS, accessExpiresAt: new Date(expires * 1000).toISOString(), refreshToken: refresh,
      refreshExpiresAt: session.expiresAt.toISOString(), sessionId: session._id};
  }
  async function revoke(sid, reason = 'logout') {
    await NativeSession.updateOne({_id: sid, revokedAt: null}, {$set: {revokedAt: new Date(), revokedReason: reason}});
  }
  return {
    async issue(user, deviceName = 'Android') {
      const sid = crypto.randomBytes(32).toString('hex'), refresh = refreshToken(sid), now = new Date();
      const session = await NativeSession.create({_id: sid, userId: user._id, authVersion: user.authVersion || 0,
        refreshDigest: sha256(refresh), deviceName, createdAt: now, lastUsedAt: now, expiresAt: new Date(+now + REFRESH_MS)});
      return tokens(session, user, refresh);
    },
    async resolve(token) {
      let payload;
      try { payload = jwt.verify(token, config.jwtSecret, {algorithms: ['HS256'], issuer, audience}); }
      catch (error) { throw failure(error instanceof jwt.TokenExpiredError ? 'ACCESS_EXPIRED' : 'ACCESS_INVALID', '登录已失效'); }
      if (payload.typ !== 'native_access' || !/^[a-f0-9]{64}$/.test(payload.sid) || !/^[a-f0-9]{24}$/.test(payload.sub) || !Number.isInteger(payload.av)) throw failure('ACCESS_INVALID', '访问令牌无效');
      const session = await NativeSession.findOne({_id: payload.sid, userId: payload.sub, authVersion: payload.av, revokedAt: null, expiresAt: {$gt: new Date()}});
      if (!session) throw failure('SESSION_REVOKED', '设备会话已失效');
      return {session, user: await account(session)};
    },
    async refresh(value) {
      const sid = parseRefresh(value), now = new Date();
      const session = await NativeSession.findOne({_id: sid, revokedAt: null, expiresAt: {$gt: now}}).select('+refreshDigest');
      if (!session) throw failure('SESSION_REVOKED', '设备会话已失效');
      const user = await account(session), digest = sha256(value);
      if (session.refreshDigest !== digest) {
        await revoke(sid, 'refresh_reuse');
        throw failure('REFRESH_REUSED', '刷新令牌已使用，请重新登录');
      }
      const refresh = refreshToken(sid);
      const updated = await NativeSession.findOneAndUpdate({_id: sid, refreshDigest: digest, revokedAt: null, expiresAt: {$gt: new Date()}},
        {$set: {refreshDigest: sha256(refresh), lastUsedAt: new Date()}}, {new: true});
      if (!updated) {
        await revoke(sid, 'refresh_reuse');
        throw failure('REFRESH_REUSED', '刷新令牌已使用，请重新登录');
      }
      return tokens(updated, user, refresh);
    },
    revoke,
  };
}
