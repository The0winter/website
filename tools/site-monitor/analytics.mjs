import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {calendarPeriods,trendCounts} from './periods.mjs';

const tokenUrl='https://oauth2.googleapis.com/token';
const scope='https://www.googleapis.com/auth/analytics.readonly';
const metrics=['activeUsers','newUsers','screenPageViews','sessions'];
const fields=names=>names.map(name=>({name}));

export function validateCredentials(value) {
  if(value?.type==='service_account' && typeof value.client_email==='string' && /^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(value.client_email) && typeof value.private_key==='string') {
    try {if(crypto.createPrivateKey(value.private_key).asymmetricKeyType!=='rsa')throw Error();}catch{throw Error('谷歌授权文件中的私钥无效');}
    return {type:value.type,client_email:value.client_email,private_key:value.private_key};
  }
  if(value?.type==='authorized_user' && ['client_id','client_secret','refresh_token'].every(k=>typeof value[k]==='string'&&value[k].length>5))return Object.fromEntries(['type','client_id','client_secret','refresh_token','quota_project_id'].filter(k=>value[k]).map(k=>[k,value[k]]));
  throw Error('请选择谷歌服务账号 JSON 或已授权的 Application Default Credentials 文件');
}

export function reportRequests(days=30) {
  if(![7,30,90].includes(days))throw Error('统计范围无效');
  const range={startDate:`${days}daysAgo`,endDate:'yesterday',name:'current'};
  const base={dateRanges:[range],returnPropertyQuota:true};
  return [
    {...base,dateRanges:[range,{startDate:`${days*2}daysAgo`,endDate:`${days+1}daysAgo`,name:'previous'},{startDate:'today',endDate:'today',name:'today'}],metrics:fields(metrics)},
    {...base,dimensions:fields(['date']),metrics:fields(metrics),orderBys:[{dimension:{dimensionName:'date'}}],limit:'100'},
    {...base,dimensions:fields(['pagePath','pageTitle']),metrics:fields(['screenPageViews']),orderBys:[{metric:{metricName:'screenPageViews'},desc:true}],limit:'10'},
    {...base,dimensions:fields(['sessionDefaultChannelGroup']),metrics:fields(['sessions']),orderBys:[{metric:{metricName:'sessions'},desc:true}],limit:'15'},
    {...base,dimensions:fields(['deviceCategory']),metrics:fields(['sessions']),orderBys:[{metric:{metricName:'sessions'},desc:true}],limit:'10'},
  ];
}

function rows(report) {
  if(!Array.isArray(report?.metricHeaders))throw Error('谷歌返回的报表不完整，请重试');
  return (report.rows||[]).map(row=>Object.fromEntries([
    ...(report.dimensionHeaders||[]).map((h,i)=>[h.name,row.dimensionValues?.[i]?.value??'']),
    ...report.metricHeaders.map((h,i)=>{const n=Number(row.metricValues?.[i]?.value);if(!Number.isFinite(n)||n<0)throw Error('谷歌返回了无效的统计数值');return [h.name,n];}),
  ]));
}
export function dateInZone(now,timeZone){return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
export function shiftDate(day,offset){return new Date(Date.parse(day+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);}
const activityMetrics=['activeUsers','newUsers'];
const activityDimensions={day:'date',week:'isoYearIsoWeek',month:'yearMonth'};
export function regionFilter(region='all') {
  if(region==='all')return undefined;
  const china={filter:{fieldName:'countryId',stringFilter:{matchType:'EXACT',value:'CN'}}};
  if(region==='china')return china;
  // Unknown geography is not a known foreign country. Never subtract CN from totals:
  // the same person may have visits in both regions and needs period-level deduplication.
  if(region==='other')return {andGroup:{expressions:[{notExpression:china},{filter:{fieldName:'countryId',stringFilter:{matchType:'FULL_REGEXP',value:'[A-Z]{2}',caseSensitive:true}}}]}};
  throw Error('统计地区无效');
}
export function activityRequests(today,region='all') {
  const filter=regionFilter(region),base={metrics:fields(activityMetrics),returnPropertyQuota:true,...(filter?{dimensionFilter:filter}:{})};
  return [
    {...base,dateRanges:[1,7,30].map(days=>({startDate:shiftDate(today,1-days),endDate:today,name:`last${days}`}))},
    ...Object.entries(trendCounts).map(([unit,count])=>{const periods=calendarPeriods(today,unit,count),dimension=activityDimensions[unit];return {...base,dateRanges:[{startDate:periods[0].date,endDate:periods.at(-1).endDate}],dimensions:fields([dimension]),orderBys:[{dimension:{dimensionName:dimension}}],limit:'400'};}),
  ];
}
export function normalizeActivity(reports,today,timeZone) {
  if(!Array.isArray(reports)||reports.length!==4)throw Error('谷歌活跃报表不完整，请重试');
  for(const report of reports) {
    if(report.metadata?.timeZone!==timeZone||activityMetrics.some(name=>!report.metricHeaders?.some(h=>h.name===name)))throw Error('谷歌活跃报表口径不一致，请重试');
  }
  const notices=[...new Set(reports.flatMap(report=>[report.metadata?.subjectToThresholding?'谷歌对部分数据应用了隐私阈值':null,report.metadata?.dataLossFromOtherRow?'部分细分数据被谷歌合并到其他项':null,report.metadata?.samplingMetadatas?.length?'本报表包含抽样数据':null]).filter(Boolean))];
  const absent=report=>Object.fromEntries(activityMetrics.map(key=>[key,report.metadata?.subjectToThresholding||report.metadata?.dataLossFromOtherRow||report.metadata?.samplingMetadatas?.length?null:0]));
  const summary=rows(reports[0]);
  return {endDate:shiftDate(today,-1),rollingEndDate:today,notices,
    rolling:Object.fromEntries([1,7,30].map(days=>[days,summary.find(r=>r.dateRange===`last${days}`)||absent(reports[0])])),
    trends:Object.fromEntries(Object.entries(trendCounts).map(([unit,count],i)=>{
      const report=reports[i+1],byKey=new Map(rows(report).map(row=>[row[activityDimensions[unit]],row]));
      return [unit,calendarPeriods(today,unit,count).map(period=>({...absent(report),...byKey.get(period.key),...period}))];
    }))};
}
export function normalizeReports(reports,days,now=Date.now()) {
  if(!Array.isArray(reports)||reports.length!==5)throw Error('谷歌返回的报表不完整，请重试');
  const [summary,daily,pages,channels,devices]=reports.map(rows);
  const timeZone=reports[0].metadata?.timeZone;
  if(!timeZone)throw Error('谷歌未返回统计时区，暂不显示日期比较');
  const today=dateInZone(now,timeZone),startDate=shiftDate(today,-days),endDate=shiftDate(today,-1);
  const zero=()=>Object.fromEntries(metrics.map(k=>[k,0]));
  const byDate=new Map(daily.map(row=>[row.date,row]));
  const limits=reports.flatMap(r=>[r.metadata?.subjectToThresholding?'谷歌对部分数据应用了隐私阈值':null,r.metadata?.dataLossFromOtherRow?'部分细分数据被谷歌合并到其他项':null,r.metadata?.samplingMetadatas?.length?'本报表包含抽样数据':null]).filter(Boolean);
  const absent=()=>limits.length?Object.fromEntries(metrics.map(k=>[k,null])):zero();
  return {status:'connected',sampledAt:new Date(now).toISOString(),days,timeZone,startDate,endDate,todayDate:today,
    current:summary.find(r=>r.dateRange==='current')||absent(),previous:summary.find(r=>r.dateRange==='previous')||absent(),today:summary.find(r=>r.dateRange==='today')||absent(),
    daily:Array.from({length:days},(_,i)=>{const date=shiftDate(startDate,i);return {...absent(),...byDate.get(date.replaceAll('-','')),date};}),
    pages:pages.map(r=>({path:r.pagePath,title:r.pageTitle,views:r.screenPageViews})),
    channels:channels.map(r=>({name:r.sessionDefaultChannelGroup,value:r.sessions})),devices:devices.map(r=>({name:r.deviceCategory,value:r.sessions})),
    notices:[...new Set(limits)],quota:reports.at(-1).propertyQuota||null};
}

export function googleCollectors(config,{fetchImpl=fetch,readFile=fs.readFile,clock=Date.now}={}) {
  // One in-memory token cache per configuration. Tokens and credentials never reach the browser or exports.
  let cached=null,authorization=null;
  async function request(url,data,signal,headers={}) {
    let response;
    try {response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),headers,body:data});}
    catch(error){if(signal.aborted)throw error;throw Error('无法连接谷歌统计，请检查网络后重试');}
    let result;try{result=await response.json();}catch{throw Error('谷歌返回了无法读取的响应');}
    if(!response.ok) {
      if(response.status===429)throw Error('谷歌查询额度暂时用完，请稍后刷新');
      if(response.status===403){const disabled=result.error?.details?.some(x=>x.reason==='SERVICE_DISABLED');throw Error(disabled?'请先在 Google Cloud 启用 Google Analytics Data API':'谷歌尚未授权读取此资源，请检查查看者权限和资源 ID');}
      if(response.status===401||url===tokenUrl){cached=null;throw Error('谷歌授权已失效或范围不足，请重新提供只读授权文件');}
      throw Error(`谷歌统计查询失败（HTTP ${response.status}），请稍后重试`);
    }
    return result;
  }
  async function accessToken(signal) {
    if(cached&&cached.expires>clock()+60000)return cached.token;
    if(authorization)return authorization;
    authorization=(async()=>{
      let credentials;try{const file=await readFile(config.gaCredentialsPath,'utf8');if(Buffer.byteLength(file)>16384)throw Error();credentials=validateCredentials(JSON.parse(file));}catch{throw Error('无法读取谷歌授权文件，请在连接设置中重新选择');}
      let body;
      if(credentials.type==='service_account') {
        const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),iat=Math.floor(clock()/1000);
        const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:credentials.client_email,scope,aud:tokenUrl,iat,exp:iat+3600});
        const assertion=unsigned+'.'+crypto.sign('RSA-SHA256',Buffer.from(unsigned),credentials.private_key).toString('base64url');
        body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion});
      }else body=new URLSearchParams({grant_type:'refresh_token',client_id:credentials.client_id,client_secret:credentials.client_secret,refresh_token:credentials.refresh_token});
      const result=await request(tokenUrl,body,signal,{'Content-Type':'application/x-www-form-urlencoded'});
      if(!result.access_token||!Number.isFinite(Number(result.expires_in)))throw Error('谷歌未返回有效的授权，请重新连接');
      cached={token:result.access_token,expires:clock()+Math.min(3600,Number(result.expires_in))*1000,quotaProject:credentials.quota_project_id};return cached.token;
    })().finally(()=>authorization=null);
    return authorization;
  }
  async function run(method,payload,signal) {
    const token=await accessToken(signal);
    return request(`https://analyticsdata.googleapis.com/v1beta/properties/${config.gaPropertyId}:${method}`,JSON.stringify(payload),signal,{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...(cached?.quotaProject?{'x-goog-user-project':cached.quotaProject}:{})});
  }
  const unavailable=()=>!config.gaPropertyId||!config.gaCredentialsPath?{status:'unconfigured',sampledAt:new Date(clock()).toISOString()}:null;
  return {
    analytics:async signal=>{
      const missing=unavailable();if(missing)return missing;
      const result=await run('batchRunReports',{requests:reportRequests(config.analyticsDays)},signal);
      const data=normalizeReports(result.reports,config.analyticsDays,clock());
      const activity=await run('batchRunReports',{requests:activityRequests(data.todayDate)},signal);
      data.activity=normalizeActivity(activity.reports,data.todayDate,data.timeZone);
      data.notices=[...new Set([...data.notices,...data.activity.notices])];
      const regions=await Promise.allSettled(['china','other'].map(async region=>{
        const report=await run('batchRunReports',{requests:activityRequests(data.todayDate,region)},signal);
        return {status:'connected',sampledAt:new Date(clock()).toISOString(),activity:normalizeActivity(report.reports,data.todayDate,data.timeZone)};
      }));
      if(signal.aborted)throw signal.reason||Error('统计读取已取消');
      data.regions=Object.fromEntries(['china','other'].map((region,i)=>[region,regions[i].status==='fulfilled'?regions[i].value:{status:'error',error:regions[i].reason.message}]));
      return data;
    },
    realtime:async signal=>{
      const missing=unavailable();if(missing)return missing;
      const result=await run('runRealtimeReport',{metrics:fields(['activeUsers']),minuteRanges:[{startMinutesAgo:29,endMinutesAgo:0}]},signal);
      if(result.kind==='analyticsData#runRealtimeReport'&&!result.metricHeaders&&!result.rows?.length&&!result.rowCount)return {status:'connected',sampledAt:new Date(clock()).toISOString(),activeUsers:null,notice:'谷歌本次未返回实时人数，等待下次刷新；暂不显示为 0。'};
      return {status:'connected',sampledAt:new Date(clock()).toISOString(),activeUsers:rows(result)[0]?.activeUsers??0};
    },
  };
}
