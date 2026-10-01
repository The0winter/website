// Reviewed origin-only moves. Keep the historical URL as the source identity so
// existing catalogs, reading editions and continuation checkpoints remain valid.
// 2026-10-01: old origin returns 301; book identity/catalog/chapter checks remain
// mandatory on the new origin. Never infer aliases from a redirect response.
export const reviewedSourceOrigins = Object.freeze([
  Object.freeze({canonical: 'https://www.shudugu.org', transport: 'https://www.suduguu.com'}),
]);

export function sourceOrigins(allowedHosts, migrations = reviewedSourceOrigins) {
  const permitted = new Set(allowedHosts);
  const active = migrations.filter(move => permitted.has(new URL(move.canonical).hostname));
  const replace = (value, from, to) => {
    const url = new URL(value), move = active.find(item => item[from] === url.origin);
    if (move && !url.username && !url.password) {
      const target = new URL(move[to]);
      url.protocol = target.protocol; url.hostname = target.hostname; url.port = target.port;
    }
    return url.href;
  };
  return {canonical: value => replace(value, 'transport', 'canonical'), transport: value => replace(value, 'canonical', 'transport')};
}

export const canonicalSourceUrl = value => sourceOrigins(reviewedSourceOrigins.map(move => new URL(move.canonical).hostname)).canonical(value);
