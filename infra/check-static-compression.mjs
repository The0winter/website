import http from 'node:http';
import https from 'node:https';
import {brotliDecompressSync, gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';

const [base, ...assets] = process.argv.slice(2);
assert(base && assets.length, 'Usage: node infra/check-static-compression.mjs BASE /_next/static/FILE.js ...');
function request(asset, encoding, method = 'GET') {
  const url = new URL(asset, base);
  assert(url.origin === new URL(base).origin && url.pathname.startsWith('/_next/static/'));
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, {method, headers: {'Accept-Encoding': encoding}}, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks)}));
      response.on('error', reject);
    });
    req.setTimeout(20000, () => req.destroy(new Error('Static asset timeout')));
    req.on('error', reject); req.end();
  });
}
const decode = ({headers, body}) => headers['content-encoding'] === 'br' ? brotliDecompressSync(body) : headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body;
const rows = [];
for (const asset of assets) {
  const [br, gzip, identity, disabled, head] = await Promise.all([
    request(asset, 'br'), request(asset, 'gzip'), request(asset, 'identity'), request(asset, 'gzip, br;q=0'), request(asset, 'br', 'HEAD'),
  ]);
  for (const response of [br, gzip, identity, disabled, head]) assert.equal(response.status, 200, `${asset}: status`);
  assert.equal(br.headers['content-encoding'], 'br', asset);
  assert.match(br.headers['content-type'], asset.endsWith('.css') ? /text\/css/ : /(?:text|application)\/javascript/, asset);
  assert.match(br.headers.vary, /Accept-Encoding/i);
  assert.match(br.headers['cache-control'], /immutable/);
  assert.equal(br.headers['x-content-type-options'], 'nosniff');
  assert.notEqual(disabled.headers['content-encoding'], 'br');
  const source = decode(identity);
  for (const response of [br, gzip, disabled]) assert.deepEqual(decode(response), source, `${asset}: decoded content differs`);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-encoding'], 'br');
  assert.equal(Number(head.headers['content-length']), br.body.length);
  rows.push({asset, raw: source.length, gzip: gzip.body.length, brotli: br.body.length});
}
assert.equal((await request('/_next/static/chunks/does-not-exist-compression-check.js', 'br')).status, 404);
console.log(JSON.stringify({assets: rows, gzip: rows.reduce((n, r) => n + r.gzip, 0), brotli: rows.reduce((n, r) => n + r.brotli, 0), verified: true}));
