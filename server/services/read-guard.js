import crypto from 'node:crypto';
import net from 'node:net';
import jwt from 'jsonwebtoken';
import {ipKeyGenerator} from 'express-rate-limit';
import {createSearchCrawlerVerifier, canonicalCrawlerIp} from './search-crawler.js';

const hour = 3600000, cookieAge = 7 * 24 * hour;
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length >= 32 && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const internalRead = req => loopback(req.socket?.remoteAddress) && equal(process.env.INTERNAL_API_SECRET, req.headers['x-internal-api-secret']);
const cookieValue = (header, name) => String(header || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);
export function readTarget(path) {
  try {path = decodeURIComponent(path);} catch {return null;}
  const chapter = /^\/book\/[a-f\d]{24}\/([a-f\d]{24})\/?$/i.exec(path) || /^\/api\/chapters\/([a-f\d]{24})\/?$/i.exec(path);
  if (chapter) return {chapter: chapter[1].toLowerCase()};
  return /^\/api\/books(?:\/|$)/i.test(path) || /^\/book\/[a-f\d]{24}\/?$/i.test(path) ? {chapter: null} : null;
}

// One process owns HTML and API budgets. No database, body, raw IP or URL is
// retained; capacity pressure evicts old state, never rejects the whole site.
export function createReadGuard(config, {clock = Date.now, maxActors = 5000, maxChapters = 100000} = {}) {
  const mode = config.readGuardMode || (config.mode === 'production' ? 'enforce' : 'off');
  const actors = new Map(), counters = {allowed:0, blocked:0, observed:0, evictions:0, reasons:{}, verifiedSearch:{google:0,bing:0,baidu:0,yandex:0}};
  const cookieName = config.mode === 'production' ? '__Host-reader-access' : 'reader-access';
  let storedChapters = 0;
  const hash = value => crypto.createHmac('sha256', config.jwtSecret).update('read-guard-v1:' + value).digest('hex');
  const drop = key => {storedChapters -= actors.get(key)?.chapters.size || 0; actors.delete(key); counters.evictions++;};
  function token(header, now) {
    const supplied = cookieValue(header, cookieName), parts = supplied?.split('.') || [];
    if (parts.length === 3 && /^[a-f\d]{32}$/.test(parts[0]) && /^\d{13}$/.test(parts[1]) && equal(parts[2], hash(parts[0] + '.' + parts[1]))) {
      const age = now - Number(parts[1]);
      if (age >= 0 && age < cookieAge) return {id: parts[0], value: supplied};
    }
    const value = crypto.randomBytes(16).toString('hex') + '.' + now;
    return {id: null, value: value + '.' + hash(value)};
  }
  function identity(input, now) {
    const reader = token(input.cookie, now);
    let account;
    try {
      const value = jwt.verify(cookieValue(input.cookie, config.mode === 'production' ? '__Host-session' : 'session') || '', config.jwtSecret, {algorithms:['HS256'], clockTimestamp:Math.floor(now / 1000)});
      if (typeof value === 'object' && /^[a-f\d]{24}$/i.test(value.id) && /^[a-f\d]{64}$/.test(value.sid)) account = value.id;
    } catch { /* Identity grouping only; authentication and revocation still run normally. */ }
    const declared = /bot\b|spider|crawler/i.test(input.userAgent || '');
    const network = net.isIP(input.ip) ? ipKeyGenerator(input.ip, 64) : 'unknown';
    return {key: hash(account ? 'account:' + account : declared || !reader.id ? 'network:' + network : 'reader:' + reader.id),
      kind: declared ? 'crawler' : account || reader.id ? 'reader' : 'unidentified',
      setCookie: reader.id ? null : `${cookieName}=${reader.value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cookieAge / 1000}${config.mode === 'production' ? '; Secure' : ''}`};
  }
  function verdict(status, reason, retryAfter, setCookie) {
    if (status !== 200) {
      counters.reasons[reason] = (counters.reasons[reason] || 0) + 1;
      if (mode === 'observe') {counters.observed++; return {status:200, reason:'observed', setCookie};}
      counters.blocked++;
    } else counters.allowed++;
    return {status, reason, retryAfter:status === 429 ? Math.max(1, Math.min(300, Math.ceil(retryAfter))) : undefined, setCookie:status === 200 ? setCookie : undefined};
  }
  function check(input, verifiedSearch = null) {
    const target = readTarget(input.path);
    const method = input.method || 'GET';
    if (mode === 'off' || !target || (!['GET','HEAD'].includes(method) && !(method === 'POST' && /^\/book\//i.test(input.path)))) return {status:200};
    const now = clock();
    // Training/bulk crawlers are distinct from user-triggered AI/search agents.
    if (/(?:\bClaudeBot\b|\bGPTBot\b|\bCCBot\b|\bBytespider\b|\bDiffbot\b|\bOmgilibot\b)/i.test(input.userAgent || '')) return verdict(403, 'bulk-crawler', 0);
    // This second argument comes only from the server verifier. Client headers,
    // cookies and delegated JSON cannot mark a caller as verified.
    const search = ['google','bing','baidu','yandex'].includes(verifiedSearch) && canonicalCrawlerIp(input.ip);
    const who = search ? {key:hash('search:' + verifiedSearch + ':' + search), kind:'search', setCookie:null} : identity(input, now);
    const {key, kind, setCookie} = who;
    if (search) counters.verifiedSearch[verifiedSearch]++;
    const burst = search ? 120 : 80, refill = search ? 10 : 5;
    for (const [id, state] of actors) {if (now - state.lastAt < hour) break; drop(id);}
    let state = actors.get(key);
    if (!state) state = {lastAt:now, tokens:burst, tokenAt:now, chapters:new Map()};
    else actors.delete(key);
    actors.set(key, state);state.lastAt = now;
    state.tokens = Math.min(burst, state.tokens + Math.max(0, now - state.tokenAt) / 1000 * refill);state.tokenAt = now;
    for (const [id, at] of state.chapters) {if (now - at < hour) break; state.chapters.delete(id);storedChapters--;}
    const shortMs = kind === 'crawler' ? 60000 : 120000;
    const shortLimit = kind === 'crawler' ? 30 : kind === 'unidentified' ? 480 : 120;
    const hourLimit = kind === 'crawler' ? 300 : kind === 'unidentified' ? 2400 : 600;
    let decision;
    if (state.tokens < 1) decision = verdict(429, 'request-burst', (1 - state.tokens) / refill, setCookie);
    else {
      state.tokens--;
      const recent = [...state.chapters.values()].filter(at => now - at < shortMs);
      if (!search && target.chapter && !state.chapters.has(target.chapter) && (recent.length >= shortLimit || state.chapters.size >= hourLimit)) {
        const wait = Math.max(recent.length >= shortLimit ? shortMs - (now - recent[0]) : 0, state.chapters.size >= hourLimit ? hour - (now - state.chapters.values().next().value) : 0);
        decision = verdict(429, 'chapter-scan', wait / 1000, setCookie);
      } else {
        if (!search && target.chapter && !state.chapters.has(target.chapter)) {state.chapters.set(target.chapter, now);storedChapters++;}
        decision = verdict(200, 'allowed', 0, setCookie);
      }
    }
    while (actors.size > maxActors || storedChapters > maxChapters) drop(actors.keys().next().value);
    return decision;
  }
  return {check, snapshot:() => ({mode, ...structuredClone(counters), actors:actors.size, rememberedChapters:storedChapters})};
}

export function installReadGuard(app, config, {searchVerifier = createSearchCrawlerVerifier()} = {}) {
  const guard = createReadGuard(config);
  const enabled = (config.readGuardMode || (config.mode === 'production' ? 'enforce' : 'off')) !== 'off';
  const decide = async input => {
    let verified = null;
    if (enabled && readTarget(input.path) && ['GET','HEAD'].includes(input.method) && !/(?:ClaudeBot|GPTBot|CCBot|Bytespider|Diffbot|Omgilibot)/i.test(input.userAgent || '')) {
      try {verified = await searchVerifier.verify(input);} catch { /* Verification failure keeps the ordinary policy. */ }
    }
    return guard.check(input, verified);
  };
  const headers = (res, result) => {
    if (result.setCookie) res.append('Set-Cookie', result.setCookie);
    if (result.retryAfter) res.set('Retry-After', String(result.retryAfter));
    res.set('Cache-Control', 'private, no-store');
  };
  // Runs before JSON parsing, readiness/auth checks, SSR and every database read.
  app.use(async (req, res, next) => {
    if (internalRead(req) || (loopback(req.socket.remoteAddress) && equal(process.env.MONITOR_SECRET, req.headers['x-monitor-secret']))) return next();
    if (!readTarget(req.path)) return next();
    const result = await decide({path:req.path, method:req.method, cookie:req.headers.cookie, userAgent:req.headers['user-agent'], ip:req.ip});
    if (result.setCookie) res.append('Set-Cookie', result.setCookie);
    if (result.status === 200) return next();
    headers(res, {...result, setCookie:null});
    res.status(result.status).json({error:result.status === 403 ? '此自动采集客户端不允许读取作品内容' : '打开章节过于频繁，请稍后重试', retryAfter:result.retryAfter});
  });
  return {
    guard,
    searchVerifier,
    async delegated(req, res) {
      if (!internalRead(req)) return res.status(404).end();
      const value = req.body;
      if (!value || typeof value.path !== 'string' || value.path.length > 300 || typeof value.ip !== 'string' || !net.isIP(value.ip) || typeof value.cookie !== 'string' || value.cookie.length > 8192 || typeof value.userAgent !== 'string' || value.userAgent.length > 1000 || !['GET','HEAD','POST'].includes(value.method)) return res.status(400).end();
      const result = await decide(value);headers(res, result);
      return res.status(200).json({status:result.status, retryAfter:result.retryAfter});
    }
  };
}
