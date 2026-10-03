import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const issuer = 'jiutian-native', audience = 'jiutian-native-visitor';
const lifetime = 90 * 86400;
export function createNativeVisitor(secret) {
  return {
    issue() {
      const id = crypto.randomBytes(32).toString('hex');
      const expires = Math.floor(Date.now() / 1000) + lifetime;
      return {visitorToken: jwt.sign({sub: id, typ: 'native_visitor', exp: expires}, secret,
        {algorithm: 'HS256', issuer, audience}), expiresAt: new Date(expires * 1000).toISOString()};
    },
    resolve(token) {
      try {
        if (typeof token !== 'string' || token.length > 1024) throw new Error('Invalid visitor');
        const value = jwt.verify(token, secret, {algorithms: ['HS256'], issuer, audience});
        if (value.typ !== 'native_visitor' || !/^[a-f0-9]{64}$/.test(value.sub)) throw new Error('Invalid visitor');
        return value.sub;
      } catch (error) {
        throw Object.assign(new Error('访客身份已失效，请重试'), {status: 401,
          code: error instanceof jwt.TokenExpiredError ? 'VISITOR_EXPIRED' : 'VISITOR_INVALID'});
      }
    },
  };
}

// These are the existing anonymous website writes. A visitor is never an account.
export function nativeVisitorWrite(req) {
  if (req.method === 'POST' && /^\/(?:books|forum\/posts)\/[a-f0-9]{24}\/views$/i.test(req.path)) return true;
  if (['POST', 'PATCH'].includes(req.method) && req.path === '/forum/preferences') return true;
  if (req.method === 'DELETE' && /^\/forum\/preferences\/[a-f0-9]{64}$/i.test(req.path)) return true;
  return req.method === 'POST' && req.path === '/forum/recommendations/events';
}
