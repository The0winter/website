// QQ Browser exposes a separate Android bridge when Web Share is unavailable.
// Only load Tencent's SDK in standalone QQ Browser, never in QQ/WeChat webviews.
type QQShareOptions = {title: string; description: string; url: string; from: string};
type QQWindow = Window & {browser?: {app?: {share?: (data: QQShareOptions) => void}}};

export function isAndroidQQBrowser() {
  const ua = navigator.userAgent;
  return /Android/i.test(ua) && /MQQBrowser\//i.test(ua) && !/MicroMessenger|\bQQ\//i.test(ua);
}

export function supportsWebShare(data: ShareData) {
  if (typeof navigator.share !== 'function') return false;
  // Some implementations expose share() without a working canShare().
  try {return typeof navigator.canShare !== 'function' || navigator.canShare(data);}
  catch {return true;}
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
