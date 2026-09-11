import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import iconv from 'iconv-lite';
import {load} from 'cheerio';
import {hash, atomicWrite, readJson} from './storage.mjs';
import {rejectedPage} from './diagnostics.mjs';

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
export function makeClient({cacheDir, allowedHosts, delayMs = 1200, retries = 2, timeoutMs = 20000, refresh = false, ttlMs = 86400000, maxBytes = 64 * 1024 * 1024, browser: browserOptions = {}, onStatus, shouldStop, signal}) {
  const hosts = new Set(allowedHosts.map(h => h.toLowerCase()));
  const resourceHosts = new Set(browserOptions.resourceHosts || []);
  const actions = [
    {...browserOptions.manualCaptcha, kind: 'verification', label: '验证码', configured: !!browserOptions.manualCaptcha},
    {...browserOptions.manualLogin, kind: 'login', label: '登录', configured: !!browserOptions.manualLogin},
  ].filter(action => action.configured);
  const requiredAction = (body, contentType) => {
    if (!actions.length) return null;
    const $ = load(decode(body, contentType));
    return actions.find(action => $(action.selector).length);
  };
  // Also space out search, detail lookup and a new worker's first request.
  let lastRequest = Date.now();
  const stats = {requests: 0, cacheHits: 0, retries: 0, bytes: 0};
  let browser, page, closingBrowser, manualAction = false;
  const stopped = () => {
    if (signal?.aborted || shouldStop?.()) throw Object.assign(Error(`任务已${signal?.aborted ? '停止' : '暂停'}，已完成的章节保留。`), {stopSource: true});
  };
  const windowClosed = () => Object.assign(Error('采集浏览器已关闭，任务已停止；已保存的章节可以继续采集。'), {stopSource: true});
  async function closeBrowser() {
    if (closingBrowser) return closingBrowser;
    if (browser?.connected) { closingBrowser = browser.close(); await closingBrowser; }
  }
  const abort = () => { void closeBrowser().catch(() => {}); };
  signal?.addEventListener('abort', abort, {once: true});
  async function windowState(state) {
    if (browserOptions.headless !== false) return;
    const cdp = await page.createCDPSession();
    try {
      const {windowId} = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', {windowId, bounds: {windowState: state}});
      if (state === 'normal') await page.bringToFront();
    } finally { await cdp.detach(); }
  }
  async function showBrowser() {
    if (!manualAction || !browser?.connected || page?.isClosed()) throw Error('当前没有等待操作的采集窗口');
    await windowState('normal');
  }
  async function ensureBrowser() {
    stopped();
    if (browser) {
      if (!browser.connected || page.isClosed()) throw windowClosed();
      return;
    }
    const {default: puppeteer} = await import('puppeteer');
    const installed = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
    const candidates = [process.env.NOVEL_CRAWLER_BROWSER, ...(browserOptions.headless === false ? [...installed, puppeteer.executablePath()] : [puppeteer.executablePath(), ...installed])].filter(Boolean);
    const executablePath = candidates.find(file => fs.existsSync(file));
    if (!executablePath) throw Error('未找到浏览器；用 NOVEL_CRAWLER_BROWSER 指定 Chrome/Edge');
    browser = await puppeteer.launch({headless: browserOptions.headless ?? true, executablePath, args: browserOptions.minimized ? ['--start-minimized'] : []});
    stopped();
    const pages = await browser.pages();
    page = pages[0] || await browser.newPage();
    await Promise.all(pages.slice(1).map(extra => extra.close()));
    // Keep one collector tab; advertisements must not leave extra blank windows.
    browser.on('targetcreated', target => {
      if (target.type() === 'page' && target !== page.target()) void target.page().then(extra => extra?.close()).catch(() => {});
    });
    if (browserOptions.minimized) await windowState('minimized');
    if (browserOptions.responseMode === 'source') await page.setCacheEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', req => {
      try {
        const parsed = new URL(req.url());
        if (['data:', 'blob:', 'about:'].includes(parsed.protocol)) return req.continue();
        httpUrl(req.url());
        const mainNavigation = req.isNavigationRequest() && req.frame() === page.mainFrame();
        const verificationAsset = browserOptions.manualVerificationMs && parsed.hostname === 'challenges.cloudflare.com';
        // Resource permissions never authorize book/navigation URLs on another host.
        if (mainNavigation || !(resourceHosts.has(parsed.hostname) || verificationAsset)) assertUrl(req.url());
        if (!manualAction && !verificationAsset && ['image', 'media', 'font'].includes(req.resourceType())) return req.abort();
        return req.continue();
      } catch { return req.abort(); }
    });
  }
  async function wait(ms) {
    const end = Date.now() + ms;
    do { stopped(); await sleep(Math.min(200, Math.max(0, end - Date.now()))); } while (Date.now() < end);
    stopped();
  }
  function assertUrl(value) {
    const url = httpUrl(value);
    if (!hosts.has(new URL(url).hostname.toLowerCase())) throw Error(`地址不在该来源配置的域名范围内：${url}`);
    return url;
  }
  async function get(input, {fresh = false, request, render = false, readySelector, rejectSelectors = []} = {}) {
    stopped();
    const rejectedSelector = (body, contentType) => {
      if (!rejectSelectors.length) return null;
      const $ = load(decode(body, contentType));
      return rejectSelectors.find(selector => $(selector).length);
    };
    const original = assertUrl(input), key = hash({url: original, request, render, browser: render ? browserOptions : undefined});
    const metaPath = path.join(cacheDir, key + '.json'), bodyPath = path.join(cacheDir, key + '.bin');
    const cached = readJson(metaPath);
    if (!fresh && !refresh && cached && Date.now() - Date.parse(cached.fetchedAt) < ttlMs && fs.existsSync(bodyPath)) {
      assertUrl(cached.url);
      const body = fs.readFileSync(bodyPath);
      // Never replay cached login, CAPTCHA or unsupported restriction pages.
      if (hash(body) === cached.hash && !requiredAction(body, cached.contentType) && !rejectedSelector(body, cached.contentType)) { stats.cacheHits++; return {...cached, body}; }
    }
    if (render) {
      if (request) throw Error('浏览器模式只支持网页导航');
      for (let attempt = 0; attempt <= retries; attempt++) {
        await wait(Math.max(0, lastRequest + delayMs - Date.now()));
        await ensureBrowser();
        let retryAfterMs, responseListener;
        try {
          lastRequest = Date.now();
          stats.requests++;
          let documentResponse;
          responseListener = response => {
            if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) documentResponse = response;
          };
          page.on('response', responseListener);
          await page.goto(original, {waitUntil: 'domcontentloaded', timeout: timeoutMs});
          if (documentResponse?.headers()['cf-mitigated'] === 'challenge') {
            const limit = browserOptions.manualVerificationMs;
            if (!limit) throw Object.assign(Error('网站要求人机验证，采集已停止；请使用支持手动验证的浏览器来源配置。'), {stopSource: true});
            manualAction = true;
            await windowState('normal');
            onStatus?.({kind: 'verification', url: original, deadline: Date.now() + limit, message: `网站要求人机验证：请在弹出的采集浏览器中手动完成，完成后自动继续。最多等待 ${Math.round(limit / 60000 * 10) / 10} 分钟。`});
            const deadline = Date.now() + limit;
            while (true) {
              stopped();
              if (page.isClosed()) throw Object.assign(Error('验证窗口已关闭，已停止采集并保留进度。'), {stopSource: true});
              assertUrl(page.url());
              if (documentResponse?.headers()['cf-mitigated'] !== 'challenge' && documentResponse?.status() === 200) break;
              if (Date.now() >= deadline) throw Object.assign(Error('等待手动人机验证超时，已停止采集并保留进度；稍后可继续。'), {stopSource: true});
              // Only observe navigation. The user performs any verification clicks.
              await wait(200);
            }
            lastRequest = Date.now();
            manualAction = false;
            if (browserOptions.minimized) await windowState('minimized');
            onStatus?.({kind: 'active', message: '验证已完成，正在继续读取网页…'});
          }
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
          let action = actions.length ? requiredAction(Buffer.from(await documentResponse.buffer()), documentResponse.headers()['content-type']) : null;
          // Login may lead to a site CAPTCHA (or vice versa). Handle each fresh
          // restriction in this same browser without accepting an intermediate preview.
          const actionDeadline = Date.now() + Math.max(0, ...actions.map(item => item.timeoutMs));
          while (action) {
            manualAction = true;
            await windowState('normal');
            if (action.openSelector) {
              const links = await page.$$(action.openSelector);
              try {
                // Open the form only; never solve or submit login/CAPTCHA challenges.
                if (links.length === 1) await links[0].click();
              } catch {
                stopped();
                if (page.isClosed()) throw windowClosed();
                // Keep the visible browser available if the site's button moved or hid.
              } finally { await Promise.all(links.map(link => link.dispose())); }
            }
            const deadline = Math.min(actionDeadline, Date.now() + action.timeoutMs);
            const instruction = action.kind === 'login' ? '网站需要登录：请在该窗口手动登录；如有验证码请自行完成' : '网站提示访问异常，需要输入验证码：请在该窗口手动完成验证';
            onStatus?.({kind: action.kind, url: original, deadline, message: `${instruction}。采集浏览器已显示，完成后返回并刷新当前章节，程序会自动继续。最多等待 ${Math.round((deadline - Date.now()) / 60000 * 10) / 10} 分钟。`});
            let checkedResponse = documentResponse;
            while (true) {
              stopped();
              if (page.isClosed()) throw windowClosed();
              assertUrl(page.url());
              if (Date.now() >= deadline) throw Object.assign(Error(`等待手动${action.label}超时，已结束本次采集；已保存章节保留，继续采集时会重新显示${action.label}窗口。`), {stopSource: true, code: action.kind === 'login' ? 'login-timeout' : 'verification-timeout', url: original});
              // Require a fresh, successful response for this exact chapter. Hiding an
              // overlay or visiting a login-success page cannot turn a preview into prose.
              if (documentResponse !== checkedResponse && page.url() === original && documentResponse?.status() === 200) {
                checkedResponse = documentResponse;
                const body = Buffer.from(await checkedResponse.buffer());
                const nextAction = requiredAction(body, checkedResponse.headers()['content-type']);
                if (!nextAction || nextAction.kind !== action.kind) {
                  if (readySelector) await page.waitForSelector(readySelector, {timeout: Math.min(timeoutMs, Math.max(1, deadline - Date.now()))});
                  action = nextAction;
                  break;
                }
              }
              await wait(200);
            }
            if (!action) {
              lastRequest = Date.now();
              manualAction = false;
              if (browserOptions.minimized) await windowState('minimized');
              onStatus?.({kind: 'active', message: '人工操作已完成，正在继续采集；已保存章节会自动跳过。'});
            }
          }
          const sourceMode = browserOptions.responseMode === 'source';
          const url = assertUrl(page.url());
          // Some sites translate their DOM after load. Source mode preserves the server's
          // stable titles and prose while using a normal browser for the HTTP request.
          const body = sourceMode ? Buffer.from(await documentResponse.buffer()) : Buffer.from(await page.content());
          const rejected = rejectedSelector(body, sourceMode ? documentResponse.headers()['content-type'] : 'text/html; charset=utf-8');
          if (rejected) throw rejectedPage(rejected, original);
          if (body.length > maxBytes) throw Error('渲染页面超过大小限制');
          stats.bytes += body.length;
          const meta = {url, original, fetchedAt: new Date().toISOString(), hash: hash(body), contentType: sourceMode ? documentResponse.headers()['content-type'] || 'text/html; charset=utf-8' : 'text/html; charset=utf-8', bytes: body.length, rendered: !sourceMode, browserFetched: true};
          atomicWrite(bodyPath, body);
          atomicWrite(metaPath, meta);
          return {...meta, body};
        } catch (error) {
          stopped();
          if (!browser.connected || page.isClosed()) throw windowClosed();
          if (attempt === retries || !Number.isFinite(error.retryAfterMs)) throw error;
          retryAfterMs = error.retryAfterMs;
          stats.retries++;
        } finally { manualAction = false; if (responseListener) page.off('response', responseListener); }
        onStatus?.({kind: 'waiting', message: `网站暂时限制访问，等待 ${Math.ceil(retryAfterMs / 1000)} 秒后重试；已完成的章节保留。`});
        await wait(retryAfterMs);
        onStatus?.({kind: 'active', message: '正在重试读取网页…'});
      }
    }
    if (request && (request.method !== 'POST' || !request.form || typeof request.form !== 'object')) throw Error('目录接口只支持显式 POST form 请求');
    let url = original;
    for (let redirects = 0; redirects <= 5; redirects++) {
      let response;
      for (let attempt = 0; attempt <= retries; attempt++) {
        await wait(Math.max(0, lastRequest + delayMs - Date.now()));
        lastRequest = Date.now();
        stats.requests++;
        try {
          response = await axios({url, signal, method: request ? 'POST' : 'GET', data: request ? new URLSearchParams(request.form).toString() : undefined, timeout: timeoutMs, responseType: 'arraybuffer', maxRedirects: 0, maxContentLength: maxBytes, maxBodyLength: maxBytes, validateStatus: () => true, headers: {'User-Agent': 'NovelCollector/1.0', Accept: '*/*', ...(request ? {'Content-Type': 'application/x-www-form-urlencoded'} : {})}});
        } catch (error) {
          stopped();
          if (attempt === retries || error.code === 'ERR_BAD_RESPONSE') throw Error(`下载失败：${url}（${error.code || error.message}）`);
          stats.retries++;
          await wait(Math.min(10000, 1000 * 2 ** attempt));
          continue;
        }
        if (response.status === 429 || response.status >= 500) {
          const raw = response.headers['retry-after'];
          const backoff = raw ? (/^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now()) : 1000 * 2 ** attempt;
          if (backoff > 60000) throw Object.assign(Error(`服务器要求稍后再试：${url}；Retry-After=${raw}`), {stopSource: true});
          if (attempt === retries) break;
          stats.retries++;
          await wait(Math.max(delayMs, Number.isFinite(backoff) ? backoff : 1000));
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
      const rejected = rejectedSelector(body, response.headers['content-type']);
      if (rejected) throw rejectedPage(rejected, url);
      stats.bytes += body.length;
      const meta = {url, original, fetchedAt: new Date().toISOString(), hash: hash(body), contentType: response.headers['content-type'] || '', bytes: body.length};
      atomicWrite(bodyPath, body);
      atomicWrite(metaPath, meta);
      return {...meta, body};
    }
    throw Error('重定向次数超过限制');
  }
  return {get, assertUrl, stats, showBrowser, close: async () => { signal?.removeEventListener('abort', abort); await closeBrowser(); }};
}
