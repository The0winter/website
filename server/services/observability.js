import crypto from 'node:crypto';

// Six bounded minute buckets; never store identities, URLs, cookies or bodies.
export function createRequestMetrics(clock = Date.now) {
  const buckets = new Map();
  function prune(now) { for (const key of buckets.keys()) if (key < Math.floor(now / 60000) - 5) buckets.delete(key); }
  return {
    record(status) {
      const now = clock(), key = Math.floor(now / 60000); prune(now);
      const bucket = buckets.get(key) || { requests: 0, errors: 0 };
      bucket.requests++; if (status >= 500) bucket.errors++;
      buckets.set(key, bucket);
    },
    snapshot() {
      const now = clock(); prune(now);
      return { at: new Date(now).toISOString(), buckets: [...buckets].map(([minute, counts]) => ({ minute, ...counts })), rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed, cpu: process.cpuUsage(), uptimeSeconds: process.uptime() };
    }
  };
}

export function allowMetrics(req) {
  const expected = process.env.MONITOR_SECRET, supplied = req.headers['x-monitor-secret'];
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
  if (!expected || expected.length < 32 || typeof supplied !== 'string') return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
