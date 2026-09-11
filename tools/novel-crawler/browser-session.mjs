import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {hash, acquireLock, atomicWrite, readJson} from './storage.mjs';

// One browser-owned profile per source, independent of book and extraction version.
// Chromium manages cookies, expiration, localStorage and IndexedDB itself.
export function browserProfile(stateDir, sourceUrl) {
  const url = new URL(sourceUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('登录状态需要有效的来源网址');
  const site = url.host.toLowerCase().replace(/^www\./, '');
  return path.join(path.resolve(stateDir), 'browser-sessions', hash(site).slice(0, 24));
}

export function lockBrowserProfile(profileDir) {
  try { return acquireLock(profileDir + '.lock'); }
  catch (error) {
    if (error.code === 'RESOURCE_BUSY') throw Object.assign(Error('该网站的采集窗口仍在使用登录状态，请等待当前任务结束再试。'), {stopSource: true});
    throw error;
  }
}

export function clearBrowserSession(stateDir, sourceUrl) {
  const root = path.resolve(stateDir, 'browser-sessions');
  const profileDir = browserProfile(stateDir, sourceUrl);
  // Never accept a user-supplied filesystem path for deleting a profile.
  if (path.dirname(profileDir) !== root || !/^[a-f0-9]{24}$/.test(path.basename(profileDir))) throw Error('登录状态目录无效');
  const release = lockBrowserProfile(profileDir);
  try { fs.rmSync(profileDir, {recursive: true, force: true}); }
  finally { release(); }
}

// Chrome's regular window discards session-only cookies on a clean exit.
// Preserve only those cookies; persistent-cookie expiry stays with Chromium.
// On Windows the extra snapshot is protected by the current user's DPAPI key.
async function windowsProtect(bytes, decrypt = false) {
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const script = `Add-Type -AssemblyName System.Security; $sessionBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd()); $sessionResult = [Security.Cryptography.ProtectedData]::${operation}($sessionBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($sessionResult))`;
  return new Promise((resolve, reject) => {
    // Never put cookie values in command arguments, diagnostics or stderr output.
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']});
    const chunks = [];
    const timeout = setTimeout(() => child.kill(), 10000);
    child.stdout.on('data', data => chunks.push(data));
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timeout); reject(Error('无法访问本机登录信息保护服务')); });
    child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve(Buffer.from(Buffer.concat(chunks).toString().trim(), 'base64')) : reject(Error('无法保护或读取本机登录信息')); });
    child.stdin.end(bytes.toString('base64'));
  });
}

export function sessionCookies(profileDir, allowedHosts) {
  const file = path.join(profileDir, 'session-cookies.json');
  let previousHash, pending = Promise.resolve();
  const allowed = cookie => typeof cookie.domain === 'string' && allowedHosts.some(host => host === cookie.domain.replace(/^\./, '') || host.endsWith('.' + cookie.domain.replace(/^\./, '')));
  return {
    async restore(context) {
      try {
        const record = readJson(file);
        if (!record) return;
        if (record.version !== 1 || record.protection !== (process.platform === 'win32' ? 'windows-dpapi' : 'local-user-file')) throw Error('Invalid session record');
        const encoded = Buffer.from(record.payload, 'base64');
        const cookies = JSON.parse((process.platform === 'win32' ? await windowsProtect(encoded, true) : encoded).toString('utf8'));
        if (!Array.isArray(cookies)) throw Error('Invalid cookies');
        const accepted = cookies.filter(allowed);
        if (accepted.length) await context.setCookie(...accepted);
        previousHash = hash(accepted);
      } catch { throw Object.assign(Error('已保存的登录信息无法读取。请点击“清除本站登录”后重新登录，已保存章节不受影响。'), {code: 'login-state-unreadable', nextStep: '点击网站栏下方的“清除本站登录”，再继续采集并重新登录。'}); }
    },
    save(context) {
      const save = async () => {
        const cookies = (await context.cookies()).filter(cookie => cookie.session && allowed(cookie)).map(cookie => Object.fromEntries(['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite', 'priority', 'sourceScheme', 'partitionKey'].filter(key => cookie[key] !== undefined).map(key => [key, cookie[key]])));
        cookies.sort((a, b) => JSON.stringify([a.domain, a.path, a.name, a.partitionKey]).localeCompare(JSON.stringify([b.domain, b.path, b.name, b.partitionKey])));
        const currentHash = hash(cookies);
        if (previousHash === currentHash || (!previousHash && !cookies.length && !fs.existsSync(file))) return;
        const plain = Buffer.from(JSON.stringify(cookies));
        const protectedBytes = process.platform === 'win32' ? await windowsProtect(plain) : plain;
        atomicWrite(file, {version: 1, protection: process.platform === 'win32' ? 'windows-dpapi' : 'local-user-file', payload: protectedBytes.toString('base64')}, {mode: 0o600});
        previousHash = currentHash;
      };
      pending = pending.then(save).catch(() => { throw Object.assign(Error('章节进度已保留，但登录信息保存失败，请检查本机登录状态目录的可写权限。'), {code: 'login-state-unsaved', nextStep: '检查本机 .novel-crawler/browser-sessions 目录的可写权限；若仍失败，将此提示交给 Codex 排查。'}); });
      return pending;
    },
  };
}
