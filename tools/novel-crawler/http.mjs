import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import iconv from 'iconv-lite';
import {hash, atomicWrite, readJson} from './storage.mjs';

export function httpUrl(value, base) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('只接受不含凭据的 HTTP(S) 地址');
  url.hash = '';
  return url.href;
}

export function decode(bytes, contentType = '', encoding) {
  const prefix = bytes.subarray(0, 2048).toString('ascii');
  const selected = encoding || (bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16-le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf16-be' : /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1] || /charset\s*=\s*["']?([\w-]+)/i.exec(prefix)?.[1] || 'utf8');
  if (!iconv.encodingExists(selected)) throw Error(`未知编码：${selected}`);
  const text = iconv.decode(bytes, selected).replace(/^\uFEFF/u, '');
  if (text.includes('\uFFFD')) throw Error('解码产生替换字符；需在来源配置中明确正确编码，未猜测或替换原文');
  return text;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function makeClient({cacheDir, allowedHosts, delayMs = 1200, retries = 2, timeoutMs = 20000, refresh = false, ttlMs = 86400000, maxBytes = 64 * 1024 * 1024, browser: browserOptions = {}}) {
  const hosts = new Set(allowedHosts.map(h => h.toLowerCase()));
  let lastRequest = 0;
  const stats = {requests: 0, cacheHits: 0, retries: 0, bytes: 0};
  let browser;
  function assertUrl(value) {
    const url = httpUrl(value);
    if (!hosts.has(new URL(url).hostname.toLowerCase())) throw Error(`地址不在该来源配置的域名范围内：${url}`);
    return url;
  }
  async function get(input, {fresh = false, request, render = false, readySelector} = {}) {
    const original = assertUrl(input), key = hash({url: original, request, render, browser: render ? browserOptions : undefined});
    const metaPath = path.join(cacheDir, key + '.json'), bodyPath = path.join(cacheDir, key + '.bin');
    const cached = readJson(metaPath);
    if (!fresh && !refresh && cached && Date.now() - Date.parse(cached.fetchedAt) < ttlMs && fs.existsSync(bodyPath)) {
      assertUrl(cached.url);
      const body = fs.readFileSync(bodyPath);
      if (hash(body) === cached.hash) { stats.cacheHits++; return {...cached, body}; }
    }
    if (render) {
      if (request) throw Error('浏览器模式只支持网页导航');
      if (!browser) {
        const {default: puppeteer} = await import('puppeteer');
        const installed = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
        const candidates = [process.env.NOVEL_CRAWLER_BROWSER, ...(browserOptions.headless === false ? [...installed, puppeteer.executablePath()] : [puppeteer.executablePath(), ...installed])].filter(Boolean);
        const executablePath = candidates.find(file => fs.existsSync(file));
        if (!executablePath) throw Error('未找到浏览器；用 NOVEL_CRAWLER_BROWSER 指定 Chrome/Edge');
        browser = await puppeteer.launch({headless: browserOptions.headless ?? true, executablePath, args: browserOptions.minimized ? ['--start-minimized'] : []});
      }
      for (let attempt = 0; attempt <= retries; attempt++) {
        const page = await browser.newPage();
        let retryAfterMs;
        try {
          // Source responses must include their body, even if another page prefetched
          // this URL. The collector already keeps its own verified response cache.
          if (browserOptions.responseMode === 'source') await page.setCacheEnabled(false);
          await page.setRequestInterception(true);
          page.on('request', req => {
            try {
              const parsed = new URL(req.url());
              if (['data:', 'blob:', 'about:'].includes(parsed.protocol)) return req.continue();
              assertUrl(req.url());
              if (['image', 'media', 'font'].includes(req.resourceType())) return req.abort();
              return req.continue();
            } catch { return req.abort(); }
          });
          await sleep(Math.max(0, lastRequest + delayMs - Date.now()));
          lastRequest = Date.now();
          stats.requests++;
          let documentResponse;
          page.on('response', response => {
            if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) documentResponse = response;
          });
          await page.goto(original, {waitUntil: 'domcontentloaded', timeout: timeoutMs});
          const status = documentResponse?.status();
          if (status === 429 || status >= 500) {
            const raw = documentResponse.headers()['retry-after'];
            const backoff = raw ? (/^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now()) : (status === 429 ? 15000 : 1000) * 2 ** attempt;
            if (backoff > 60000) throw Object.assign(Error(`服务器要求稍后再试：${original}；Retry-After=${raw}`), {stopSource: true});
            const error = Error(`HTTP ${status}：${original}；网站暂时限制访问，请稍后继续`);
            error.stopSource = status === 429;
            error.retryAfterMs = Math.max(delayMs, Number.isFinite(backoff) ? backoff : 15000);
            throw error;
          }
          if (readySelector) {
            try { await page.waitForSelector(readySelector, {timeout: timeoutMs}); }
            catch {
              const title = (await page.title().catch(() => '')).replace(/\s+/gu, ' ').slice(0, 100);
              throw Error(`页面未出现所需内容（HTTP ${documentResponse?.status() || '未知'}${title ? `，${title}` : ''}）；网站可能要求验证或已改变页面结构`);
            }
          }
          if (!documentResponse || documentResponse.status() !== 200) throw Error(`浏览器未取得有效页面（HTTP ${documentResponse?.status() || '未知'}）；如需人工验证，请在普通浏览器中核实网站是否可用`);
          const sourceMode = browserOptions.responseMode === 'source';
          const url = assertUrl(page.url());
          // Some sites translate their DOM after load. Source mode preserves the server's
          // stable titles and prose while using a normal browser for the HTTP request.
          const body = sourceMode ? Buffer.from(await documentResponse.buffer()) : Buffer.from(await page.content());
          if (body.length > maxBytes) throw Error('渲染页面超过大小限制');
          stats.bytes += body.length;
          const meta = {url, original, fetchedAt: new Date().toISOString(), hash: hash(body), contentType: sourceMode ? documentResponse.headers()['content-type'] || 'text/html; charset=utf-8' : 'text/html; charset=utf-8', bytes: body.length, rendered: !sourceMode, browserFetched: true};
          atomicWrite(bodyPath, body);
          atomicWrite(metaPath, meta);
          return {...meta, body};
        } catch (error) {
          if (attempt === retries || !Number.isFinite(error.retryAfterMs)) throw error;
          retryAfterMs = error.retryAfterMs;
          stats.retries++;
        } finally { await page.close(); }
        await sleep(retryAfterMs);
      }
    }
    if (request && (request.method !== 'POST' || !request.form || typeof request.form !== 'object')) throw Error('目录接口只支持显式 POST form 请求');
    let url = original;
    for (let redirects = 0; redirects <= 5; redirects++) {
      let response;
      for (let attempt = 0; attempt <= retries; attempt++) {
        await sleep(Math.max(0, lastRequest + delayMs - Date.now()));
        lastRequest = Date.now();
        stats.requests++;
        try {
          response = await axios({url, method: request ? 'POST' : 'GET', data: request ? new URLSearchParams(request.form).toString() : undefined, timeout: timeoutMs, responseType: 'arraybuffer', maxRedirects: 0, maxContentLength: maxBytes, maxBodyLength: maxBytes, validateStatus: () => true, headers: {'User-Agent': 'NovelCollector/1.0', Accept: '*/*', ...(request ? {'Content-Type': 'application/x-www-form-urlencoded'} : {})}});
        } catch (error) {
          if (attempt === retries || error.code === 'ERR_BAD_RESPONSE') throw Error(`下载失败：${url}（${error.code || error.message}）`);
          stats.retries++;
          await sleep(Math.min(10000, 1000 * 2 ** attempt));
          continue;
        }
        if (response.status === 429 || response.status >= 500) {
          const raw = response.headers['retry-after'];
          const backoff = raw ? (/^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now()) : 1000 * 2 ** attempt;
          if (backoff > 60000) throw Object.assign(Error(`服务器要求稍后再试：${url}；Retry-After=${raw}`), {stopSource: true});
          if (attempt === retries) break;
          stats.retries++;
          await sleep(Math.max(delayMs, Number.isFinite(backoff) ? backoff : 1000));
          continue;
        }
        break;
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.headers.location) throw Error('重定向缺少 Location');
        url = assertUrl(httpUrl(response.headers.location, url));
        continue;
      }
      if (response.status !== 200) throw Object.assign(Error(`HTTP ${response.status}：${url}`), {stopSource: response.status === 429});
      const body = Buffer.from(response.data);
      stats.bytes += body.length;
      const meta = {url, original, fetchedAt: new Date().toISOString(), hash: hash(body), contentType: response.headers['content-type'] || '', bytes: body.length};
      atomicWrite(bodyPath, body);
      atomicWrite(metaPath, meta);
      return {...meta, body};
    }
    throw Error('重定向次数超过限制');
  }
  return {get, assertUrl, stats, close: async () => { if (browser) await browser.close(); }};
}
