export function readConfig(env = process.env) {
  const mode = env.APP_ENV;
  if (!['test', 'development', 'production'].includes(mode)) throw new Error('APP_ENV must be explicit');
  const uri = env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is required');
  if (mode !== 'production' && !/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/test1_(test|dev)(\?|$)/.test(uri)) {
    throw new Error('Local execution requires a loopback test1_test/test1_dev database');
  }
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  if(mode==='production'&&(/replace|change-me/i.test(env.JWT_SECRET)||!env.ALLOWED_ORIGINS))throw new Error('Production secrets and origins must be explicitly configured');
  if (mode !== 'production' && env.EXTERNAL_SERVICES === 'enabled') throw new Error('External services forbidden outside production');
  const origins = (env.ALLOWED_ORIGINS || 'http://127.0.0.1:3000,http://localhost:3000').split(',');
  for (const origin of origins) if (new URL(origin).origin !== origin) throw new Error('Invalid ALLOWED_ORIGINS');
  if(mode==='production'&&origins.some(origin=>!origin.startsWith('https://')))throw new Error('Production origins require HTTPS');
  const trustProxy=env.TRUST_PROXY||'none';if(!['none','loopback'].includes(trustProxy))throw new Error('TRUST_PROXY must be none or loopback');
  const writeMode=env.WRITE_MODE||(mode==='production'?'readonly':'readwrite');if(!['readonly','readwrite'].includes(writeMode))throw new Error('Invalid WRITE_MODE');
  const port = Number(env.PORT || 5000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  return { mode, uri, origins, port, host: env.HOST || '127.0.0.1', jwtSecret: env.JWT_SECRET, trustProxy, writeMode };
}
