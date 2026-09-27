import fs from 'node:fs';

const HOUR=3600000,DAY=24*HOUR;
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)&&Number.isFinite(Date.parse(value))?value:null;
const classA=new Set('ListBuckets PutBucket ListObjects PutObject CopyObject CompleteMultipartUpload CreateMultipartUpload LifecycleStorageTierTransition ListMultipartUploads UploadPart UploadPartCopy ListParts PutBucketEncryption PutBucketCors PutBucketLifecycleConfiguration'.split(' '));
const classB=new Set('HeadBucket HeadObject GetObject UsageSummary GetBucketEncryption GetBucketLocation GetBucketCors GetBucketLifecycleConfiguration'.split(' '));
const free=new Set(['DeleteObject','DeleteObjects','DeleteBucket','AbortMultipartUpload']);

// This file is local only. Never include credentials, provider errors or OAuth responses in a snapshot.
export function readCloudCredentials(file) {
  if(!file||!fs.existsSync(file))return {};
  try {if(fs.statSync(file).size>16384)throw Error();const data=JSON.parse(fs.readFileSync(file,'utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}
  catch {throw Error('云端只读授权文件无法读取，请检查本机配置');}
}
export function hasCloudflareCredentials(file){try{return !!readCloudCredentials(file).cloudflare?.token;}catch{return true;}}

export function summarizeR2(account,{start,end,expiresAt}={}) {
  const operations=account?.r2OperationsAdaptiveGroups,storage=account?.r2StorageAdaptiveGroups;
  if(!Array.isArray(operations)||!Array.isArray(storage))throw Error('R2 没有返回完整统计结果');
  const totals={classA:0,classB:0,free:0,unknown:0,unauthorized:0,errors:0};
  for(const row of operations){
    const n=row.sum?.requests,d=row.dimensions;if(!valid(n)||!d)throw Error('R2 操作统计格式异常');
    if(Number(d.responseStatusCode)===401){totals.unauthorized+=n;continue;}
    if(d.actionStatus!=='success')totals.errors+=n;
    totals[classA.has(d.actionType)?'classA':classB.has(d.actionType)?'classB':free.has(d.actionType)?'free':'unknown']+=n;
  }
  const buckets=new Map();
  for(const row of storage){const d=row.dimensions,m=row.max;
    if(!d?.bucketName||!date(d.datetime)||!valid(m?.payloadSize)||!valid(m?.metadataSize)||!valid(m?.objectCount))throw Error('R2 容量统计格式异常');
    if(!buckets.has(d.bucketName)||Date.parse(buckets.get(d.bucketName).sampledAt)<Date.parse(d.datetime))buckets.set(d.bucketName,{bucket:d.bucketName,sampledAt:d.datetime,bytes:m.payloadSize,metadataBytes:m.metadataSize,objects:m.objectCount});
  }
  return {status:'connected',sampledAt:end,start,end,expiresAt:date(expiresAt),operations:{...totals,complete:operations.length<1000,estimated:true,freeClassA:1e6,freeClassB:1e7},storage:{buckets:[...buckets.values()],complete:storage.length<1000}};
}

// Integrate hourly average rates only over observed intervals; do not fill missing hours with zero.
// Process network counters can include internal traffic. This is a risk estimate, not a quota balance.
export function integrateNetwork(measurements,start,end) {
  const lo=Date.parse(start),hi=Date.parse(end);
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||hi<=lo)throw Error('Atlas 统计时间范围无效');
  const result={};
  for(const [key,name] of [['inbound','NETWORK_BYTES_IN'],['outbound','NETWORK_BYTES_OUT']]){
    const metric=measurements?.find(m=>m.name===name);
    if(metric?.units!=='BYTES_PER_SECOND'||!Array.isArray(metric.dataPoints))throw Error('Atlas 未提供所需的网络速率指标');
    const points=new Map();for(const p of metric.dataPoints)if(date(p.timestamp))points.set(Date.parse(p.timestamp),p.value);
    let bytes=0,seconds=0,cursor=lo;
    for(const [at,value] of [...points].sort((a,b)=>a[0]-b[0])){
      const from=Math.max(lo,at-HOUR,cursor),to=Math.min(hi,at);
      if(to<=from)continue;
      if(valid(value)){bytes+=value*(to-from)/1000;seconds+=(to-from)/1000;}
      cursor=Math.max(cursor,to);
    }
    result[key]={bytes:seconds?bytes:null,coverage:seconds/((hi-lo)/1000)};
  }
  return result;
}

export function cloudCollectors(file,{fetchImpl=fetch,clock=Date.now,readCredentials=()=>readCloudCredentials(file)}={}) {
  let oauth;
  async function request(label,url,options,signal){
    let response;
    try {response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)])});}
    catch {throw Error(`${label}连接失败或超时，请检查网络后刷新`);}
    if(!response.ok){await response.body?.cancel();const status=response.status;throw Error(`${label}读取失败（HTTP ${status}）${status===401?'：授权可能已过期':status===403?'：请检查只读权限和本机出口 IP 白名单':status===429?'：请求过多，请稍后重试':''}`);}
    try {const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>4*1024**2)throw Error();chunks.push(p.value);}}finally{await reader.cancel();}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
    catch {throw Error(`${label}未返回有效的统计数据`);}
  }
  return {
    cloudflare:async signal=>{
      const c=readCredentials().cloudflare;if(!c)return {status:'unconfigured'};
      if(!/^[a-f0-9]{32}$/.test(c.accountId||'')||typeof c.token!=='string'||!c.token)throw Error('Cloudflare 只读授权配置不完整');
      const now=new Date(clock()),start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString(),end=now.toISOString();
      const data=await request('Cloudflare','https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:`Bearer ${c.token}`,'Content-Type':'application/json'},body:JSON.stringify({query:`query($account:string!,$start:Time!,$end:Time!,$recent:Time!){viewer{accounts(filter:{accountTag:$account}){r2OperationsAdaptiveGroups(limit:1000,filter:{datetime_geq:$start,datetime_leq:$end}){sum{requests} dimensions{actionType actionStatus responseStatusCode}} r2StorageAdaptiveGroups(limit:1000,filter:{datetime_geq:$recent,datetime_leq:$end},orderBy:[datetime_DESC]){max{objectCount payloadSize metadataSize} dimensions{datetime bucketName}}}}}`,variables:{account:c.accountId,start,end,recent:new Date(+now-DAY).toISOString()}})},signal);
      if(data.errors?.length||data.data?.viewer?.accounts?.length!==1)throw Error('Cloudflare 统计查询失败，请检查 Account Analytics Read 权限与授权有效期');
      return summarizeR2(data.data.viewer.accounts[0],{start,end,expiresAt:c.expiresAt});
    },
    atlasCloud:async signal=>{
      const c=readCredentials().atlas;if(!c)return {status:'unconfigured'};
      if(!/^[a-f0-9]{24}$/.test(c.projectId||'')||!c.clusterName||!c.clientId||!c.clientSecret)throw Error('Atlas 只读授权配置不完整');
      const identity=c.clientId+':'+c.clientSecret;
      if(!oauth||oauth.identity!==identity||oauth.until<clock()+60000){
        const data=await request('Atlas 授权','https://cloud.mongodb.com/api/oauth/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(identity).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'},signal);
        if(typeof data.access_token!=='string'||!valid(data.expires_in)||data.expires_in<60)throw Error('Atlas 未返回有效访问凭据');
        oauth={identity,token:data.access_token,until:clock()+Math.min(data.expires_in,3600)*1000};
      }
      const headers={Authorization:`Bearer ${oauth.token}`,Accept:'application/vnd.atlas.2023-01-01+json'},base=`https://cloud.mongodb.com/api/atlas/v2/groups/${c.projectId}`;
      const cluster=await request('Atlas',base+'/clusters/'+encodeURIComponent(c.clusterName),{headers},signal);
      const hosts=new Set(String(cluster.connectionStrings?.standard||'').replace(/^mongodb:\/\//,'').split('/')[0].split(','));
      const list=await request('Atlas',base+'/processes?itemsPerPage=500',{headers},signal);
      if(!Array.isArray(list.results)||list.results.length>=500||(valid(list.totalCount)&&list.totalCount>list.results.length))throw Error('Atlas 节点列表不完整');
      const nodes=list.results.filter(p=>hosts.has(p.id)||hosts.has(`${p.userAlias}:${p.port}`));
      if(!nodes.length||nodes.length!==hosts.size||nodes.length>30)throw Error('Atlas 目标集群节点尚未完整识别');
      const end=new Date(Math.floor(clock()/HOUR)*HOUR).toISOString(),start=new Date(Date.parse(end)-7*DAY).toISOString(),samples=[];
      for(const node of nodes){
        const params=new URLSearchParams({granularity:'PT1H',start,end});params.append('m','NETWORK_BYTES_IN');params.append('m','NETWORK_BYTES_OUT');
        const data=await request('Atlas',`${base}/processes/${encodeURIComponent(node.id)}/measurements?${params}`,{headers},signal);
        if(data.granularity!=='PT1H')throw Error('Atlas 返回的采样粒度与请求不一致');
        samples.push(integrateNetwork(data.measurements,start,end));
      }
      const transfer={};for(const key of ['inbound','outbound'])transfer[key]={bytes:samples.some(s=>s[key].bytes===null)?null:samples.reduce((n,s)=>n+s[key].bytes,0),coverage:Math.min(...samples.map(s=>s[key].coverage))};
      const tier=cluster.providerSettings?.instanceSizeName||null;
      return {status:'connected',sampledAt:new Date(clock()).toISOString(),expiresAt:date(c.expiresAt),clusterName:c.clusterName,tier,start,end,nodes:nodes.length,estimated:true,referenceLimitBytes:tier==='M0'?10e9:null,...transfer};
    }
  };
}
