// Prefer standard Web Share; use UC/QQ bridges only when actually exposed.
// Only load Tencent's SDK in standalone QQ Browser, never in QQ/WeChat webviews.
type QQShareOptions = {title: string; description: string; url: string; from: string};
type QQWindow = Window & {browser?: {app?: {share?: (data: QQShareOptions) => void}}};
type UCShareArgs = [string, string, string, string | undefined, string, string, string];
type UCWindow = Window & {
  ucweb?: {startRequest?: (action: string, args: UCShareArgs) => unknown};
  ucbrowser?: {web_shareEX?: (data: string) => unknown; web_share?: (...args: UCShareArgs) => unknown};
};
type BookShareData = {title: string; text: string; url: string};

const embeddedBrowser = (ua: string) => /MicroMessenger|\bQQ\//i.test(ua);

export function isAndroidQQBrowser() {
  const ua = navigator.userAgent;
  return /Android/i.test(ua) && /MQQBrowser\//i.test(ua) && !embeddedBrowser(ua);
}

export function webShareData(data: BookShareData, linkOnly = false): ShareData | null {
  if (typeof navigator.share !== 'function') return null;
  // A browser may accept a link while rejecting combined text/title/link data.
  // Select synchronously so invocation stays in the original user gesture.
  const candidates = linkOnly ? [{url:data.url}] : [data, {title:data.title,url:data.url}, {url:data.url}];
  for (const candidate of candidates) {
    try {if (typeof navigator.canShare !== 'function' || navigator.canShare(candidate)) return candidate;}
    catch {return candidate;}
  }
  return null;
}

function ucPlatform() {
  const ua = navigator.userAgent;
  if (!/UCBrowser\//i.test(ua) || /Quark\//i.test(ua) || embeddedBrowser(ua)) return null;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
  return null;
}

export function hasUCShare() {
  const browser = window as UCWindow;
  const platform = ucPlatform();
  return platform === 'android' ? typeof browser.ucweb?.startRequest === 'function'
    : platform === 'ios' && (typeof browser.ucbrowser?.web_shareEX === 'function' || typeof browser.ucbrowser?.web_share === 'function');
}

export function shareWithUC(data: {title: string; url: string}) {
  if (!hasUCShare()) throw new Error('UC Browser sharing unavailable');
  const browser = window as UCWindow;
  // UC's native contracts: https://github.com/fa-ge/NativeShare/tree/master/src
  // Leave target unset so the user chooses both the application and recipient.
  const args: UCShareArgs = [data.title, data.title, data.url, ucPlatform() === 'android' ? '' : undefined, '', '九天小说站', ''];
  const result = ucPlatform() === 'android' ? browser.ucweb!.startRequest!('shell.page_share', args)
    : typeof browser.ucbrowser?.web_shareEX === 'function'
      ? browser.ucbrowser.web_shareEX(JSON.stringify({title:data.title,content:data.title,sourceUrl:data.url,source:'九天小说站',imageUrl:''}))
      : browser.ucbrowser!.web_share!(...args);
  if (result === false) throw new Error('UC Browser rejected sharing');
}

export function browserShareHint() {
  const ua = navigator.userAgent;
  if (embeddedBrowser(ua)) return '也可打开当前应用菜单，选择“分享”';
  if (/Quark\//i.test(ua)) return '也可打开夸克浏览器菜单，选择“分享”';
  if (/UCBrowser\//i.test(ua)) return '也可打开 UC 浏览器菜单，选择“分享”';
  if (/MiuiBrowser\//i.test(ua)) return '也可打开小米浏览器菜单，选择“分享”';
  if (/MQQBrowser\//i.test(ua)) return '也可打开 QQ 浏览器菜单，选择“分享”';
  if (/Edg(?:A|iOS)?\//i.test(ua)) return '也可打开 Edge 菜单，选择“分享”';
  if (/Chrome\/|CriOS\//i.test(ua)) return '也可打开 Chrome 菜单，选择“分享”';
  if (/Safari\//i.test(ua) && /iPhone|iPad|iPod|Macintosh/i.test(ua) && !/Android|FxiOS\//i.test(ua)) return '也可使用 Safari 工具栏或菜单中的分享按钮';
  return '也可打开浏览器菜单，选择“分享”';
}

export function hasQQShare() {
  return isAndroidQQBrowser() && typeof (window as QQWindow).browser?.app?.share === 'function';
}

let qqSDK: Promise<boolean> | undefined;
export function prepareQQShare(): Promise<boolean> {
  if (!isAndroidQQBrowser()) return Promise.resolve(false);
  if (hasQQShare()) return Promise.resolve(true);
  if (!qqSDK) {
    qqSDK = new Promise<boolean>(resolve => {
      const script = document.createElement('script');
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        script.onload = script.onerror = null;
        const ready = hasQQShare();
        if (!ready) script.remove();
        resolve(ready);
      };
      const timeout = window.setTimeout(finish, 5000);
      script.src = 'https://jsapi.qq.com/get?api=app.share';
      script.async = true;
      script.referrerPolicy = 'no-referrer';
      script.onload = script.onerror = finish;
      document.head.appendChild(script);
    }).then(ready => {
      if (!ready) qqSDK = undefined; // A later opening can retry a failed load.
      return ready;
    });
  }
  return qqSDK;
}

export function shareWithQQ(data: {title: string; url: string}) {
  if (!hasQQShare()) throw new Error('QQ Browser sharing unavailable');
  // Call directly in the click handler; loading the SDK here loses activation.
  (window as QQWindow).browser!.app!.share!({title:data.title, description:data.title, url:data.url, from:'九天小说站'});
}
