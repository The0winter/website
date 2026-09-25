// User activity is coalesced across tabs. There is no recurring idle heartbeat.
export const SESSION_ACTIVITY_INTERVAL_MS = 5 * 60 * 1000;

export function startSessionActivity(userId: string, renew: () => Promise<boolean>, onExpired: () => void) {
  const key = `session-activity-v1:${userId}`;
  let stopped = false, pending = false, running = false;
  let localAttempt = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const visible = () => document.visibilityState === 'visible';
  const lastAttempt = () => {
    let shared = 0;
    try { shared = Number(localStorage.getItem(key)) || 0; } catch {}
    // A clock correction or corrupt browser value must not disable renewal.
    const now = Date.now();
    return Math.max(localAttempt <= now ? localAttempt : 0, shared <= now ? shared : 0);
  };
  const cancelTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const delay = () => Math.max(0, lastAttempt() + SESSION_ACTIVITY_INTERVAL_MS - Date.now());
  const send = async () => {
    if (stopped || !pending || !visible() || running) return;
    if (delay() > 0) { schedule(); return; }
    pending = false;
    running = true;
    // Reserve before the request, including failures: offline/repeated events
    // cannot cause a retry storm. Web Locks serializes this step across tabs.
    localAttempt = Date.now();
    try { localStorage.setItem(key, String(localAttempt)); } catch {}
    try {
      const valid = await renew();
      if (!stopped && !valid) { stop(); onExpired(); }
    } catch { /* Transient failures leave login intact; later activity retries. */ }
    finally {
      // Start the next window after the response. Network jitter must not send
      // the next heartbeat just before the server's five-minute write window.
      localAttempt = Date.now();
      try { localStorage.setItem(key, String(localAttempt)); } catch {}
      running = false;
      if (pending && !stopped && visible()) { cancelTimer(); schedule(); }
    }
  };
  const flush = () => {
    timer = undefined;
    if (stopped || !pending || !visible()) return;
    if (navigator.locks) {
      void navigator.locks.request(key, {ifAvailable: true}, async lock => {
        if (lock) await send();
        else if (!stopped) { timer = setTimeout(flush, SESSION_ACTIVITY_INTERVAL_MS); }
      }).catch(() => { if (!stopped) void send(); });
    } else void send();
  };
  function schedule() {
    if (!stopped && pending && visible() && timer === undefined) timer = setTimeout(flush, delay());
  }
  const activity = () => {
    if (stopped || !visible()) return;
    pending = true;
    schedule();
  };
  const visibility = () => {
    if (visible()) activity();
    else { pending = false; cancelTimer(); }
  };
  const events = ['pointerdown', 'touchstart', 'keydown', 'scroll', 'wheel', 'focus', 'pageshow'];
  function stop() {
    stopped = true;
    pending = false;
    cancelTimer();
    for (const event of events) window.removeEventListener(event, activity, true);
    document.removeEventListener('visibilitychange', visibility);
  }
  for (const event of events) window.addEventListener(event, activity, {passive: true, capture: true});
  document.addEventListener('visibilitychange', visibility);
  activity();
  return stop;
}
