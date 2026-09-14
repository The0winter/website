import {randomUUID} from 'node:crypto';
import {literal} from './codec.js';

export class LocalSqlTransport {
  static async open(filename) {
    const {DatabaseSync} = await import('node:sqlite');
    return new LocalSqlTransport(new DatabaseSync(filename));
  }
  constructor(database) {this.database = database; this.remote = false;database.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;');}
  async query(sql) {return this.database.prepare(sql).all();}
  async stageValue(id,document) {this.database.prepare('INSERT INTO _d1_values VALUES(?,?,?)').run(id,document,Date.now());}
  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {for (const sql of statements) this.database.exec(sql); this.database.exec('COMMIT');}
    catch (error) {this.database.exec('ROLLBACK');throw error;}
  }
  async close() {this.database.close();}
}

export class D1Transport {
  constructor({accountId, databaseId, token, fetcher = fetch}) {
    if (!/^[a-f0-9]{32}$/.test(accountId || '') || !/^[a-f0-9-]{36}$/.test(databaseId || '') || !token) throw new Error('D1 credentials are required');
    this.url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
    this.token = token; this.fetcher = fetcher; this.remote = true;
    this.pendingReads = [];
    this.metrics = {requests:0, rowsRead:0, rowsWritten:0, errors:0};
  }
  async execute(sql, params = []) {
    this.metrics.requests++;
    let response;
    try {response = await this.fetcher(this.url, {method:'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(10000)});}
    catch {throw Object.assign(new Error('D1 request outcome is unknown'), {code:'D1_OUTCOME_UNKNOWN',status:503});}
    let body;
    try {body = await response.json();} catch {throw Object.assign(new Error('D1 returned an invalid response'), {code:'D1_OUTCOME_UNKNOWN',status:503});}
    if (!response.ok || !body.success || body.result?.some(row => row.success === false)) {
      this.metrics.errors++;
      // SQL values and access credentials must not be included in application logs.
      const conflict = body.errors?.some(row => /D1_WRITE_CONFLICT/.test(row.message));
      const duplicate = body.errors?.some(row => /UNIQUE constraint/.test(row.message));
      throw Object.assign(new Error(conflict ? 'Concurrent database write' : duplicate ? 'Duplicate database key' : 'D1 request failed'),
        {code:conflict?'D1_WRITE_CONFLICT':duplicate?11000:response.status>=500?'D1_OUTCOME_UNKNOWN':'D1_REQUEST_FAILED', status:503, httpStatus:response.status});
    }
    for (const row of body.result) {this.metrics.rowsRead += row.meta?.rows_read || 0;this.metrics.rowsWritten += row.meta?.rows_written || 0;}
    return body.result;
  }
  query(sql) {
    if (!/^\s*(SELECT|EXPLAIN)\b/i.test(sql)) throw new Error('Read query requires SELECT or EXPLAIN');
    return new Promise((resolve,reject) => {
      this.pendingReads.push({sql,resolve,reject});
      this.readScheduled ||= setImmediate(() => {this.readScheduled = null; this.flushReads();});
    });
  }
  async flushReads() {
    const pending = this.pendingReads.splice(0);
    while (pending.length) {
      const group = []; let bytes = 0;
      while (pending.length && group.length < 25 && (bytes + Buffer.byteLength(pending[0].sql) < 75000 || !group.length)) {
        const item = pending.shift(); bytes += Buffer.byteLength(item.sql); group.push(item);
      }
      try {
        const result = await this.execute(group.map(item => item.sql.replace(/;\s*$/, '')).join(';\n') + ';');
        if (result.length !== group.length) throw new Error('Unexpected D1 result count');
        group.forEach((item,index) => item.resolve(result[index].results || []));
      } catch(error) {for (const item of group) item.reject(error);}
    }
  }
  async batch(statements, {recordCommit = false} = {}) {
    const commit = randomUUID();
    const sql = [...statements, ...(recordCommit ? [`INSERT INTO _d1_commits(id,created_at) VALUES(${literal(commit)},${Date.now()})`] : [])].join(';\n') + ';';
    try {await this.execute(sql);}
    catch (error) {
      if (recordCommit && error.code === 'D1_OUTCOME_UNKNOWN') {
        const rows = await this.query(`SELECT id FROM _d1_commits WHERE id=${literal(commit)}`).catch(() => []);
        if (rows.length) return;
      }
      throw error;
    }
  }
  async stageValue(id,document) {await this.execute('INSERT INTO _d1_values VALUES(?,?,?)',[id,document,Date.now()]);}
  async close() {}
}
