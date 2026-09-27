const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const fresh=m=>!!m?.data&&m.status!=='error'&&!m.stale;
export function assessUsage(snapshot) {
  const atlas=snapshot.modules?.atlas,server=snapshot.modules?.server,r=atlas?.data?.runtime;
  const operations=fresh(atlas)&&valid(atlas.data.operationsPerSecond)?atlas.data.operationsPerSecond:null;
  const connections=fresh(atlas)&&r?.status==='available'&&valid(r.connections?.current)&&valid(r.connections?.available)?{used:r.connections.current,total:r.connections.current+r.connections.available}:null;
  const warning=snapshot.config?.atlasOpsWarning??70,danger=snapshot.config?.atlasOpsDanger??90;
  const operationTone=operations===null?'unknown':operations>=danger?'danger':operations>=warning?'warning':'good';
  const connectionRatio=connections?.total>0?connections.used/connections.total*100:null;
  const connectionTone=connectionRatio===null?'unknown':connectionRatio>=90?'danger':connectionRatio>=80?'warning':'good';
  const minute=Math.floor((snapshot.now??Date.now())/60000),byMinute=new Map();
  if(fresh(server))for(const b of server.data.api?.buckets||[])if(Number.isInteger(b.minute)&&b.minute>=minute-5&&b.minute<minute&&valid(b.requests)&&valid(b.errors)&&b.errors<=b.requests)byMinute.set(b.minute,b);
  const buckets=[...byMinute.values()],complete=buckets.length===5;
  const requests=complete?buckets.reduce((n,b)=>n+b.requests,0):null,errors=complete?buckets.reduce((n,b)=>n+b.errors,0):null;
  const errorRatio=requests>0?errors/requests*100:requests===0?0:null;
  const httpTone=errorRatio===null?'unknown':requests>=100&&errorRatio>1?'danger':'good';
  const alerts=[];
  if(['warning','danger'].includes(operationTone))alerts.push({level:operationTone,title:'数据库操作速率偏高',detail:`采样平均 ${operations.toFixed(1)} 次/秒，已达到配置的提醒阈值。它是连接节点的观测值，不等于全站浏览次数或瞬时峰值。`,target:'resources'});
  if(['warning','danger'].includes(connectionTone))alerts.push({level:connectionTone,title:'数据库连接数接近上限',detail:`连接节点已使用 ${connections.used} / ${connections.total} 个连接。`,target:'resources'});
  if(httpTone==='danger')alerts.push({level:'danger',title:'业务接口错误率偏高',detail:`最近五个完整分钟 ${requests} 次请求中有 ${errors} 次服务器错误。`,target:'resources'});
  return {operations,operationTone,warning,danger,connections,connectionRatio,connectionTone,requests,errors,errorRatio,httpTone,alerts};
}
