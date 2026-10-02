import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {safeHtml} from '../security.js';
const compress = promisify(gzip);

// Public reading responses only. Keep their existing private/no-store policy;
// compression must not turn personalized like state into a shared HTTP cache.
export async function forumJson(req, res, value) {
  // Match the regular res.json forum boundary, including legacy imported HTML.
  const body = JSON.stringify(value, (key, item) => key === 'content' && typeof item === 'string' ? safeHtml(item) : item);
  res.set('Cache-Control', 'private, no-store');
  res.vary('Accept-Encoding');
  if (Buffer.byteLength(body) < 1024 || !req.headers['accept-encoding'] || !req.acceptsEncodings('gzip')) return res.type('json').send(body);
  const compressed = await compress(body, {level: 4});
  if (res.destroyed) return;
  return res.set('Content-Encoding', 'gzip').type('json').send(compressed);
}
