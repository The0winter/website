const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const fresh=m=>!!m?.data&&m.status!=='error'&&!m.stale;
const tone=ratio=>ratio===null?'unknown':ratio>=90?'danger':ratio>=80?'warning':'good';
export function cloudStorage(snapshot){
  const module=snapshot.modules?.cloudflare,known=snapshot.modules?.r2?.data?.buckets;
  if(!fresh(module)||module.data.status!=='connected'||!module.data.storage?.complete||known?.length!==2)return null;
  const buckets=known.map(k=>{const b=module.data.storage.buckets.find(b=>b.bucket===k.bucket);return b?{...b,id:k.id}:null;});
  if(buckets.some(b=>!b||!valid(b.bytes)||(snapshot.now??Date.now())-Date.parse(b.sampledAt)>2*3600000))return null;
  return {buckets,bytes:buckets.reduce((n,b)=>n+b.bytes,0),objects:buckets.reduce((n,b)=>n+b.objects,0)};
}
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
  const cloud=snapshot.modules?.cloudflare,ac=snapshot.modules?.atlasCloud;
  const r2=fresh(cloud)&&cloud.data.status==='connected'&&cloud.data.operations?.complete?cloud.data.operations:null;
  // A previous month's successful sample must never stand in for the current month.
  const monthMatches=cloud?.data?.start?.slice(0,7)===new Date(snapshot.now??Date.now()).toISOString().slice(0,7);
  const r2A=r2&&monthMatches?r2.classA/r2.freeClassA*100:null,r2B=r2&&monthMatches?r2.classB/r2.freeClassB*100:null;
  const transfer=fresh(ac)&&ac.data.status==='connected'?ac.data:null;
  const inbound=transfer&&valid(transfer.inbound?.bytes)?transfer.inbound.bytes:null,outbound=transfer&&valid(transfer.outbound?.bytes)?transfer.outbound.bytes:null;
  const transferRatio=transfer?.referenceLimitBytes&&inbound!==null&&outbound!==null?Math.max(inbound,outbound)/transfer.referenceLimitBytes*100:null;
  const coverage=transfer?Math.min(transfer.inbound?.coverage??0,transfer.outbound?.coverage??0):0;
  const transferTone=transferRatio!==null&&transferRatio>=80?tone(transferRatio):coverage<.98?'unknown':tone(transferRatio);
  for(const [label,ratio] of [['A 类写入/列表',r2A],['B 类读取',r2B]])if(ratio!==null&&ratio>=80)alerts.push({level:tone(ratio),title:`R2 ${label}接近免费额度`,detail:`本月分析统计约为 Standard 免费额度的 ${ratio.toFixed(1)}%。超出通常产生费用，并非数据库容量耗尽；最终以 Cloudflare 账单为准。`,target:'resources'});
  if(['warning','danger'].includes(transferTone))alerts.push({level:transferTone,title:'Atlas 七日传输估算偏高',detail:'节点网络统计已接近 Free 套餐单向 10 GB 参考额度；可能含内部流量，请到 Atlas 核对。触及实际额度会限速。',target:'resources'});
  for(const [m,label] of [[cloud,'Cloudflare'],[ac,'Atlas 管理 API']]){
    if(m&&(m.status==='error'||m.stale))alerts.push({level:'unknown',title:`${label}用量未能更新`,detail:m.error||'上次用量已过期，请刷新后确认。',target:'resources'});
    const days=(Date.parse(m?.data?.expiresAt)-(snapshot.now??Date.now()))/86400000;
    if(Number.isFinite(days)&&days<=14)alerts.push({level:days<=0?'danger':'warning',title:`${label}只读授权${days<=0?'已到期':'即将到期'}`,detail:`授权到期日期 ${m.data.expiresAt.slice(0,10)}，需要续期以继续监测。`,target:'resources'});
  }
  return {operations,operationTone,warning,danger,connections,connectionRatio,connectionTone,requests,errors,errorRatio,httpTone,r2:monthMatches?r2:null,r2A,r2B,r2ATone:tone(r2A),r2BTone:tone(r2B),transfer,inbound,outbound,coverage,transferRatio,transferTone,alerts};
}
