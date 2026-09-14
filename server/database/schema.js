import {createHash} from 'node:crypto';
import {encode, identifier, literal} from './codec.js';
import {fieldSql, filterSql, jsonPath} from './query.js';

export const baseSchema = [
  'CREATE TABLE IF NOT EXISTS _d1_meta(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL)',
  'INSERT OR IGNORE INTO _d1_meta VALUES(1,0)',
  'CREATE TABLE IF NOT EXISTS _d1_guard(id TEXT PRIMARY KEY,expected INTEGER NOT NULL)',
  `CREATE TRIGGER IF NOT EXISTS _d1_check_guard BEFORE INSERT ON _d1_guard WHEN NEW.expected<>(SELECT revision FROM _d1_meta WHERE id=1) BEGIN SELECT RAISE(ABORT,'D1_WRITE_CONFLICT'); END`,
  'CREATE TABLE IF NOT EXISTS _d1_indexes(collection_name TEXT NOT NULL,index_name TEXT NOT NULL,definition TEXT NOT NULL,PRIMARY KEY(collection_name,index_name))',
  'CREATE TABLE IF NOT EXISTS _d1_commits(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS _d1_commits_expiry ON _d1_commits(created_at)',
  'CREATE TABLE IF NOT EXISTS _d1_values(id TEXT PRIMARY KEY,document TEXT NOT NULL,created_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS _d1_values_expiry ON _d1_values(created_at)',
];
export function collectionSchema(name) {
  const table = identifier(name);
  if (name.startsWith('_d1_')) throw new Error('Reserved collection name');
  return [
    `CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY NOT NULL,document TEXT NOT NULL CHECK(json_valid(document)),revision INTEGER NOT NULL DEFAULT 1)`,
    ...['INSERT','UPDATE','DELETE'].map(action => `CREATE TRIGGER IF NOT EXISTS ${identifier(`${name}_${action.toLowerCase()}_revision`)} AFTER ${action} ON ${table} BEGIN UPDATE _d1_meta SET revision=revision+1 WHERE id=1; END`),
  ];
}
export function indexSchema(collection, keys, options = {}) {
  if (Object.values(keys).some(value => value !== 1 && value !== -1)) throw new Error('Unsupported SQL index type');
  const name = options.name || Object.entries(keys).map(([k,v]) => `${k}_${v}`).join('_');
  const sqlName = 'idx_' + createHash('sha256').update(collection + '\0' + name).digest('hex').slice(0,24);
  const fields = Object.entries(keys).map(([field,direction]) => `${fieldSql(field)} ${direction === -1 ? 'DESC' : 'ASC'}`);
  let predicate = options.partialFilterExpression ? filterSql(options.partialFilterExpression) : null;
  if (options.sparse) predicate = Object.keys(keys).map(field => `json_type(document,${literal(jsonPath(field))}) IS NOT NULL`).join(' OR ');
  const definition = {name,key:keys,...options,sqlName};
  return {name, statements:[
    `CREATE ${options.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${identifier(sqlName)} ON ${identifier(collection)}(${fields.join(',')})${predicate ? ' WHERE ' + predicate : ''}`,
    `INSERT INTO _d1_indexes VALUES(${literal(collection)},${literal(name)},${literal(encode(definition))}) ON CONFLICT(collection_name,index_name) DO UPDATE SET definition=excluded.definition`,
  ]};
}
