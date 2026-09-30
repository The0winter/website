import {AsyncLocalStorage} from 'node:async_hooks';
import mongoose from 'mongoose';

const context = new AsyncLocalStorage(), clients = new WeakMap();
const hourMs = 3600000;
const purposes = new Set(['list', 'detail', 'reading', 'catalog', 'sitemap', 'traffic', 'reviews', 'import', 'personal', 'forum', 'other', 'background']);

function purposeOf(path) {
  if (path === '/api/traffic/observe') return 'traffic';
  if (path === '/api/sitemap-books' || /^\/api\/books\/(?:sitemap-pool|[^/]+\/sitemap-chapters)\/?$/.test(path)) return 'sitemap';
  if (path === '/api/books') return 'list';
  if (/^\/api\/books\/[^/]+(?:\/detail)?\/?$/.test(path)) return 'detail';
  if (/^\/api\/chapters\/[^/]+\/?$/.test(path)) return 'reading';
  if (/^\/api\/books\/[^/]+\/(catalog|chapters|statistics)(\/|$)/.test(path)) return 'catalog';
  if (/\/(reviews|review-reactions|paragraph-comments)(\/|$)/.test(path)) return 'reviews';
  if (/^\/api\/(admin|import|library-import)(\/|$)/.test(path)) return 'import';
  if (/^\/api\/(library|auth|users|session)(\/|$)/.test(path)) return 'personal';
  if (path.startsWith('/api/forum')) return 'forum';
  return 'other';
}

export function trackDatabaseRequest(req, res, next) {
  context.run(purposeOf(req.path), next);
}

// Only counters survive an event. No query, document, URL, account or credential
// is retained. BSON reply sizes estimate logical traffic, not billed wire bytes.
export function observeMongoClient(client, {clock = Date.now, purpose = 'background', log = () => {}} = {}) {
  if (clients.has(client)) return clients.get(client);
  const buckets = new Map(), pending = new Map(), startedAt = new Date(clock()).toISOString();
  const totals = {commands:0, failed:0, estimatedBsonReplyBytes:0, unmeasuredReplies:0};
  let untrackedCommands = 0, previousHour;
  const key = event => `${event.connectionId}:${event.requestId}`;
  function prune() {
    const hour = Math.floor(clock() / hourMs);
    for (const time of buckets.keys()) if (time < hour - 47) buckets.delete(time);
    return hour;
  }
  function record(group, failed, bytes, measured) {
    const hour = prune();
    if (previousHour !== undefined && previousHour !== hour && buckets.has(previousHour)) {
      try {log({event:'database-usage-hour', hour:previousHour, purposes:buckets.get(previousHour)});} catch { /* metrics never fail a request */ }
    }
    previousHour = hour;
    if (!buckets.has(hour)) buckets.set(hour, {});
    const groups = buckets.get(hour);
    const row = groups[group] ||= {commands:0, failed:0, estimatedBsonReplyBytes:0, unmeasuredReplies:0};
    row.commands++; row.failed += Number(failed); row.estimatedBsonReplyBytes += bytes;
    row.unmeasuredReplies += Number(!measured && !failed);
    totals.commands++; totals.failed += Number(failed); totals.estimatedBsonReplyBytes += bytes;
    totals.unmeasuredReplies += Number(!measured && !failed);
  }
  client.on('commandStarted', event => {
    const group = context.getStore() || purpose;
    // Request IDs correlate replies without retaining the command contents.
    pending.set(key(event), {group:purposes.has(group) ? group : 'background', at:clock()});
    while (pending.size > 2000 || (pending.size && clock() - pending.values().next().value.at > 120000)) {
      pending.delete(pending.keys().next().value); untrackedCommands++;
    }
  });
  function completed(event, failed) {
    const id = key(event), item = pending.get(id); pending.delete(id);
    if (!item) return;
    let bytes = 0, measured = false;
    if (!failed) try {bytes = mongoose.mongo.BSON.calculateObjectSize(event.reply); measured = true;} catch { /* unknown BSON value */ }
    record(item.group, failed, bytes, measured);
  }
  client.on('commandSucceeded', event => completed(event, false));
  client.on('commandFailed', event => completed(event, true));
  const usage = {snapshot() {
    prune();
    return {measurement:'estimated-uncompressed-command-reply-bson', startedAt, windowHours:48,
      untrackedCommands, totals:{...totals}, buckets:[...buckets].map(([hour, groups]) => ({hour, purposes:structuredClone(groups)}))};
  }};
  clients.set(client, usage);
  return usage;
}

export function mongoUsageSnapshot(connection = mongoose.connection) {
  if (connection.readyState !== 1 || connection.transport) return undefined;
  return clients.get(connection.getClient())?.snapshot();
}
