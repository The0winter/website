// SQL stores JSON documents; ObjectIds retain their existing public string IDs.
// Dates and binary values carry explicit tags so lean queries remain lossless.
export function normalize(value) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date || value instanceof RegExp || Buffer.isBuffer(value)) return value;
  if (value.$__ && typeof value.toObject === 'function') return normalize(value.toObject({depopulate:true,flattenMaps:true}));
  if (value._bsontype === 'ObjectId') return value.toHexString();
  if (value._bsontype === 'Binary') return Buffer.from(value.buffer);
  if (value._bsontype) throw new Error('Unsupported BSON type: ' + value._bsontype);
  if (Array.isArray(value)) return Array.from(value,normalize);
  return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).map(([k,v]) => [k, normalize(v)]));
}

function pack(value) {
  if (value instanceof Date) return {$date: value.toISOString()};
  if (Buffer.isBuffer(value)) return {$binary: value.toString('base64')};
  if (Array.isArray(value)) return value.map(pack);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,pack(v)]));
  return value;
}
function unpack(value) {
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && typeof value.$date === 'string') return new Date(value.$date);
  if (Object.keys(value).length === 1 && typeof value.$binary === 'string') return Buffer.from(value.$binary,'base64');
  if (Array.isArray(value)) return value.map(unpack);
  return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,unpack(v)]));
}
export const encode = value => JSON.stringify(pack(normalize(value)));
export const decode = value => unpack(JSON.parse(value));
export const clone = value => decode(encode(value));

export function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error('Invalid SQL identifier');
  return '"' + value + '"';
}
export function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite SQL number');
    return String(value);
  }
  if (value instanceof Date) value = value.toISOString();
  if (typeof value !== 'string') throw new Error('Unsupported SQL value');
  if (value.includes('\0')) return `CAST(X'${Buffer.from(value).toString('hex')}' AS TEXT)`;
  return "'" + value.replaceAll("'", "''") + "'";
}
