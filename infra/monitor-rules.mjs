export function evaluateMonitor(sample, state = {}) {
  const now = sample.now;
  const next = { ...state }, alerts = [];
  if (!sample.ready) {
    next.unavailableSince ??= now;
    if (now - next.unavailableSince >= 60000) alerts.push('service-unavailable');
  } else delete next.unavailableSince;
  // Only five complete minute buckets, excluding the partial current minute.
  const minute = Math.floor(now / 60000);
  const buckets = (sample.metrics?.buckets || []).filter(b => b.minute >= minute - 5 && b.minute < minute);
  const count = buckets.reduce((n,b) => n+b.requests,0), errors = buckets.reduce((n,b) => n+b.errors,0);
  if (buckets.length === 5 && count >= 100 && errors / count > 0.01) alerts.push('http-5xx');
  if (sample.diskUsed > 0.8) alerts.push('disk-space');
  if (!Number.isFinite(sample.backupAt) || now - sample.backupAt > 26 * 3600000) alerts.push('backup-stale');
  if (!sample.metrics) alerts.push('metrics-unavailable');
  next.alerts = alerts;
  return { state: next, alerts, changed: JSON.stringify(state.alerts) !== JSON.stringify(alerts), requestCount: count, errorCount: errors };
}
