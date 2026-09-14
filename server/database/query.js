import {literal, normalize} from './codec.js';

export function jsonPath(field) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(field)) throw new Error('Unsupported indexed document path');
  return '$' + field.split('.').map(x => /^\d+$/.test(x) ? '[' + x + ']' : '."' + x + '"').join('');
}
export function fieldSql(field, document = 'document') {
  if(field === '_id' && document === 'document')return 'id';
  const path=jsonPath(field);
  return `COALESCE(json_extract(${document},${literal(path + '."$date"')}),json_extract(${document},${literal(path)}))`;
}

// Exact scalar filters use SQLite indexes, limits, counts and projections.
// Other predicates use a SQL superset, then the complete document predicate.
export function filterPlan(input={},scalarFields=new Set(['_id']),document='document') {
  const filter=normalize(input),parts=[];let exact=true;
  const fallback=()=>{exact=false;return '1';};
  const validValue=v=>v===null || typeof v!=='object' || v instanceof Date;
  for(const [field,value] of Object.entries(filter)) {
    if(field==='$and'||field==='$or') {
      if(!Array.isArray(value))throw new Error('Invalid logical query');
      const children=value.map(v=>filterPlan(v,scalarFields,document));
      exact &&= children.every(v=>v.exact);
      parts.push('('+ (children.length ? children.map(v=>v.sql).join(field==='$and'?' AND ':' OR ') : field==='$and'?'1':'0') +')');continue;
    }
    if(field.startsWith('$')||!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(field)){parts.push(fallback());continue;}
    const expr=fieldSql(field,document),path=jsonPath(field),scalar=scalarFields.has(field);
    const withArray=condition=>scalar ? condition : fallback();
    const equal=v=>v===null ? `${expr} IS NULL` : `${expr}=${literal(v)}`;
    if(validValue(value)) {parts.push(withArray(equal(value)));continue;}
    if(value instanceof RegExp || Array.isArray(value)){parts.push(fallback());continue;}
    for(const [op,v] of Object.entries(value)) {
      if(op==='$exists') parts.push(scalar || !field.includes('.') || /\.\d+(?:\.|$)/.test(field) ? `json_type(${document},${literal(path)}) IS ${v?'NOT ':''}NULL` : fallback());
      else if(['$gt','$gte','$lt','$lte'].includes(op) && validValue(v))parts.push(withArray(`${expr}${{$gt:'>',$gte:'>=',$lt:'<',$lte:'<='}[op]}${literal(v)}`));
      else if(op==='$eq' && validValue(v))parts.push(withArray(equal(v)));
      else if(op==='$ne' && validValue(v))parts.push(withArray(v===null?`${expr} IS NOT NULL`:`(${expr} IS NULL OR ${expr}<>${literal(v)})`));
      else if(op==='$in'&&Array.isArray(v)&&v.every(validValue))parts.push(v.length?withArray('('+v.map(equal).join(' OR ')+')'):'0');
      else parts.push(fallback());
    }
  }
  return {sql:parts.length?'('+parts.join(' AND ')+')':'1',exact};
}
export const filterSql=(filter,document='document')=>filterPlan(filter,new Set(['_id',...Object.keys(filter).filter(key=>!key.startsWith('$'))]),document).sql;

export function projectionSql(projection) {
  if(!projection || !Object.keys(projection).length)return 'document';
  if(Object.keys(projection).some(field=>field.includes('.')))return null;
  if(Object.entries(projection).some(([,value])=>value!==0&&value!==1&&value!==false&&value!==true))return null;
  const include=Object.entries(projection).filter(([key,value])=>key!=='_id'&&value).map(([key])=>key);
  const includeMode=include.length>0 || (projection._id===1 && Object.keys(projection).length===1);
  if(!includeMode)return `json_remove(document,${Object.keys(projection).filter(key=>!projection[key]).map(key=>literal(jsonPath(key))).join(',')})`;
  if(projection._id!==0 && projection._id!==false)include.push('_id');
  if(include.some(field=>field.includes('.')))return null;
  const values=include.map(field=>`SELECT ${literal(field)} AS key,json_quote(json_extract(document,${literal(jsonPath(field))})) AS value WHERE json_type(document,${literal(jsonPath(field))}) IS NOT NULL`);
  return `(SELECT json_group_object(key,json(value)) FROM (${values.join(' UNION ALL ')}))`;
}
