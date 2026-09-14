import mongoose from 'mongoose';
import {installSqlDriver} from './driver.js';

export async function connectDatabase(uri = process.env.DATABASE_URL || process.env.MONGO_URI, options = {}) {
  if (!uri) throw new Error('DATABASE_URL is required');
  if (/^(d1|sqlite):/.test(uri)) installSqlDriver();
  mongoose.set('bufferCommands', false);
  return mongoose.connect(uri, {autoIndex:false, autoCreate:false, serverSelectionTimeoutMS:5000, connectTimeoutMS:5000, socketTimeoutMS:10000, ...options});
}

// Readiness checks perform a real round trip. Concurrent requests share the
// check, with a short cache to avoid a separate Cloudflare request per API call.
let check, checkedConnection, checkedAt = 0, healthy = false;
export async function databaseReady() {
  const connection = mongoose.connection;
  if (connection.readyState !== 1) return false;
  if (!connection.transport) return true;
  if (checkedConnection !== connection) {checkedAt = 0; checkedConnection = connection;}
  if (Date.now() - checkedAt < 1000) return healthy;
  check ||= connection.db.command({ping:1}).then(() => healthy = true, () => healthy = false).finally(() => {checkedAt = Date.now(); check = null;});
  return check;
}

export async function cleanupExpired(connection = mongoose.connection, now = new Date()) {
  if (!connection.transport) return;
  const {identifier, literal, decode} = await import('./codec.js');
  const {fieldSql} = await import('./query.js');
  const indexes = await connection.transport.query('SELECT collection_name,definition FROM _d1_indexes');
  const statements = [];
  for (const row of indexes) {
    const definition = decode(row.definition);
    if (!Number.isFinite(definition.expireAfterSeconds) || Object.keys(definition.key).length !== 1) continue;
    const field = Object.keys(definition.key)[0];
    const cutoff = new Date(+now - definition.expireAfterSeconds * 1000);
    const table = identifier(row.collection_name);
    statements.push(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${fieldSql(field)}<=${literal(cutoff)} LIMIT 500)`);
  }
  statements.push(`DELETE FROM _d1_commits WHERE id IN (SELECT id FROM _d1_commits WHERE created_at<${+now - 86400000} LIMIT 500)`);
  statements.push(`DELETE FROM _d1_values WHERE id IN (SELECT id FROM _d1_values WHERE created_at<${+now - 86400000} LIMIT 500)`);
  await connection.transport.batch(statements);
}

export function startExpiryCleanup() {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {await cleanupExpired();} catch {console.error('Database expiry cleanup unavailable');} finally {busy = false;}
  }, 15 * 60000);
  timer.unref();
  return () => clearInterval(timer);
}
