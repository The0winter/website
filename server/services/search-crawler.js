import {Resolver} from 'node:dns/promises';
import net from 'node:net';

const providers = {
  google: /\b(?:Googlebot(?:-[a-z]+)?|Google-InspectionTool)\b/i,
  bing: /\b(?:bingbot|msnbot(?:-media)?|BingPreview)\b/i,
  baidu: /\bBaiduspider(?:-[a-z]+)?\b/i,
};
export function searchCrawlerProvider(userAgent) {
  const matches = Object.keys(providers).filter(key => providers[key].test(String(userAgent || '')));
  return matches.length === 1 ? matches[0] : null;
}

export function canonicalCrawlerIp(value) {
  if (typeof value !== 'string' || value.includes('%') || !net.isIP(value)) return null;
  if (net.isIP(value) === 4) return value;
  try {
    const ip = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([a-f\d]+):([a-f\d]+)$/.exec(ip);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      return [high >> 8, high & 255, low >> 8, low & 255].join('.');
    }
    return ip;
  } catch {return null;}
}

function officialHost(provider, host) {
  if (typeof host !== 'string') return false;
  const name = host.toLowerCase().replace(/\.$/, '');
  if (!/^[a-z\d.-]{1,253}$/.test(name)) return false;
  if (provider === 'google') return name.endsWith('.googlebot.com') || /^(?:google-proxy-|rate-limited-proxy-)[a-z\d-]+\.google\.com$/.test(name);
  if (provider === 'bing') return name.endsWith('.search.msn.com');
  return provider === 'baidu' && (name.endsWith('.baidu.com') || name.endsWith('.baidu.jp'));
}

// Only a claimed search crawler triggers DNS. PTR suffixes alone are not proof:
// the official hostname must forward-resolve to the original source address.
// No Atlas queries, external HTTP feeds, timers or unbounded lookup queue.
export function createSearchCrawlerVerifier({clock = Date.now, resolverFactory = () => new Resolver({timeout:500, tries:1}),
  maxEntries = 2048, maxPending = 16, timeoutMs = 1200, positiveMs = 6 * 3600000, negativeMs = 10 * 60000,
  transientMs = 30000, staleMs = 24 * 3600000} = {}) {
  const cache = new Map(), pending = new Map();
  const counts = {lookups:0, cacheHits:0, staleHits:0, rejected:0, errors:0, busy:0, evictions:0, verified:{google:0,bing:0,baidu:0}};
  function remember(key, value) {
    cache.delete(key);cache.set(key, value);
    while (cache.size > maxEntries) {cache.delete(cache.keys().next().value);counts.evictions++;}
  }
  async function resolve(provider, ip) {
    const resolver = resolverFactory();let timer;
    try {
      return await Promise.race([
        (async () => {
          const names = (await resolver.reverse(ip)).filter(name => officialHost(provider, name)).slice(0, 4);
          const replies = await Promise.allSettled(names.map(name => net.isIP(ip) === 4 ? resolver.resolve4(name) : resolver.resolve6(name)));
          if (replies.some(reply => reply.status === 'fulfilled' && reply.value.some(address => canonicalCrawlerIp(address) === ip))) return true;
          const transient = replies.find(reply => reply.status === 'rejected' && !['ENOTFOUND','ENODATA'].includes(reply.reason?.code));
          if (transient) throw transient.reason;
          return false;
        })(),
        new Promise((_, reject) => {timer = setTimeout(() => {resolver.cancel();reject(Object.assign(new Error('DNS deadline'), {code:'ETIMEOUT'}));}, timeoutMs);}),
      ]);
    } finally {clearTimeout(timer);resolver.cancel();}
  }
  function start(key, provider, ip, previous) {
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= maxPending) {counts.busy++;return Promise.resolve(null);}
    counts.lookups++;
    const job = resolve(provider, ip).then(verified => {
      if (verified) counts.verified[provider]++;else counts.rejected++;
      const now = clock();remember(key, {provider:verified ? provider : null, until:now + (verified ? positiveMs : negativeMs), staleUntil:verified ? now + staleMs : now});
      return verified ? provider : null;
    }).catch(error => {
      const now = clock(), missing = ['ENOTFOUND','ENODATA'].includes(error.code);
      if (missing) counts.rejected++;else counts.errors++;
      // A transient DNS outage may reuse a previously proven identity for at
      // most 24h, but never grants a first-time/failed caller extra privileges.
      if (!missing && previous?.provider && previous.staleUntil > now) {
        remember(key, {...previous, until:Math.min(now + transientMs, previous.staleUntil)});return previous.provider;
      }
      remember(key, {provider:null, until:now + (missing ? negativeMs : transientMs), staleUntil:now});return null;
    }).finally(() => pending.delete(key));
    pending.set(key, job);return job;
  }
  return {
    async verify({ip:rawIp, userAgent}) {
      const provider = searchCrawlerProvider(userAgent), ip = canonicalCrawlerIp(rawIp);
      if (!provider || !ip) return null;
      const key = provider + ':' + ip, entry = cache.get(key), now = clock();
      if (entry && entry.until > now) {counts.cacheHits++;cache.delete(key);cache.set(key, entry);return entry.provider;}
      if (entry?.provider && entry.staleUntil > now) {counts.staleHits++;void start(key, provider, ip, entry);return entry.provider;}
      return start(key, provider, ip, entry);
    },
    snapshot:() => ({...structuredClone(counts), entries:cache.size, pending:pending.size}),
  };
}
