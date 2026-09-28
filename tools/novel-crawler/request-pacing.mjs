// A source lane owns this clock, including cooldowns across sequential books.
// Adaptive HTTP pacing is opt-in; browser navigation keeps the configured delay.
export function requestPacing({clock = {}, delayMs, adaptive = false, now = Date.now}) {
  if (typeof adaptive !== 'boolean') throw Error('adaptivePacing 必须为布尔值');
  clock.lastRequest ??= now();
  clock.delayMs = Math.max(clock.delayMs || 0, delayMs);
  if (!clock.httpPacing) clock.httpPacing = {baseDelayMs: clock.delayMs, intervalMs: clock.delayMs, healthy: 0, backedOff: false};
  const state = clock.httpPacing;
  if (state.baseDelayMs < clock.delayMs) {
    state.baseDelayMs = clock.delayMs;
    state.intervalMs = Math.max(state.intervalMs, clock.delayMs);
    state.healthy = 0;
  }
  const defer = ms => { clock.blockedUntil = Math.max(clock.blockedUntil || 0, now() + ms); };
  return {
    spacing(http = false) {
      const interval = http && adaptive ? state.intervalMs : clock.delayMs;
      return Math.max(0, clock.lastRequest + interval - now(), (clock.blockedUntil || 0) - now());
    },
    start() { clock.lastRequest = now(); },
    defer,
    succeeded(elapsedMs) {
      if (!adaptive || state.backedOff) return;
      // Slow responses do not establish spare capacity. Only healthy network
      // responses count; cache hits and redirects cannot accelerate a source.
      if (elapsedMs > state.intervalMs / 2) { state.healthy = 0; return; }
      if (++state.healthy < 12) return;
      state.healthy = 0;
      const floor = Math.min(clock.delayMs, Math.max(500, Math.ceil(clock.delayMs / 4)));
      state.intervalMs = Math.max(floor, Math.ceil(state.intervalMs * 0.75));
    },
    failed() {
      if (!adaptive) return;
      // One error ends acceleration for this source lane for the entire run.
      // A new book must not immediately speed up again after a rate limit.
      state.backedOff = true;
      state.healthy = 0;
      state.intervalMs = clock.delayMs;
      defer(clock.delayMs);
    },
  };
}
