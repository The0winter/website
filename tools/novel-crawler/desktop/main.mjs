import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import {defaultStateDir} from '../core.mjs';
import {atomicWrite, readJson, withLock} from '../storage.mjs';
import {createDesktop} from './server.mjs';

const stateDir = defaultStateDir, instanceFile = path.join(stateDir, 'desktop-instance.json');
await withLock(path.join(stateDir, 'desktop-launch.lock'), async () => {
  const previous = readJson(instanceFile);
  if (previous?.port && previous.token) {
    try {
      const response = await fetch(`http://127.0.0.1:${previous.port}/api/focus`, {method: 'POST', headers: {'x-desktop-token': previous.token}, signal: AbortSignal.timeout(2000)});
      if (response.ok) return;
    } catch {}
  }
  const executablePath = [process.env.NOVEL_CRAWLER_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', puppeteer.executablePath()].filter(Boolean).find(file => fs.existsSync(file));
  if (!executablePath) throw Error('Chrome or Edge was not found. Install a browser or set NOVEL_CRAWLER_BROWSER.');
  let browser, page, shuttingDown = false;
  const app = await createDesktop({onFocus: async () => {
    if (page && !page.isClosed()) {
      const cdp = await page.createCDPSession();
      try {
        const {windowId} = await cdp.send('Browser.getWindowForTarget');
        await cdp.send('Browser.setWindowBounds', {windowId, bounds: {windowState: 'normal'}});
        await page.bringToFront();
      } finally { await cdp.detach(); }
    }
  }});
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await app.close();
      if (browser?.connected) await browser.close();
      if (readJson(instanceFile)?.token === app.token) fs.unlinkSync(instanceFile);
    } catch (error) { console.error(error.message); }
  }
  try {
    browser = await puppeteer.launch({executablePath, headless: false, userDataDir: path.join(stateDir, 'desktop-browser'), defaultViewport: null, args: [`--app=${app.url}`, '--window-size=1180,920', '--no-default-browser-check']});
    page = (await browser.pages()).find(p => p.url().startsWith(app.baseUrl));
    if (!page) { page = await browser.newPage(); await page.goto(app.url); }
    browser.on('disconnected', shutdown);
    page.on('close', shutdown);
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    atomicWrite(instanceFile, {pid: process.pid, port: app.server.address().port, token: app.token});
    console.log('Novel downloader is ready. Close the window to save and exit.');
  } catch (error) { await shutdown(); throw error; }
});
