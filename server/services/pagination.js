import {fail} from './content.js';
export function pagination(query,defaultLimit=20,maxLimit=100){
  const parse=(value,fallback,max)=>{if(value===undefined)return fallback;if(typeof value!=='string'||!/^\d+$/.test(value))fail(400,'分页参数无效');const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>max)fail(400,'分页参数无效');return n;};
  const page=parse(query.page,1,100000),limit=parse(query.limit,defaultLimit,maxLimit);return {page,limit,skip:(page-1)*limit};
}
