// Serialized into the SSH worker; all identities remain on the server.
export async function readTraffic(db,request={},now=Date.now()) {
  const timeZone='Asia/Shanghai',today=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  const shift=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const meta=await db.collection('traffic_observation_meta').findOne({_id:'observation'},{maxTimeMS:5000});
  if(!meta)return {status:'unconfigured',sampledAt:new Date(now).toISOString()};
  const start=new Date(meta.startedAt),startedDate=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(start);
  // Query only aggregate membership, never raw pages, cookies, IPs or account records.
  const collection=db.collection('traffic_observation_summaries'),cutoff=periods('month',6)[0].date;
  const visitors=await collection.aggregate([
    {$group:{_id:'$visitor',firstRaw:{$min:'$day'},firstKept:{$min:{$cond:[{$ne:['$classification','high']},'$day','9999-12-31']}},rawDays:{$addToSet:{$cond:[{$gte:['$day',cutoff]},'$day',null]}},keptDays:{$addToSet:{$cond:[{$and:[{$gte:['$day',cutoff]},{$ne:['$classification','high']}]},'$day',null]}}}},
    {$limit:10001},
  ],{maxTimeMS:5000,allowDiskUse:false}).toArray();
  if(visitors.length>10000)throw Error('第一方统计超出本次查询预算，暂不展示不完整人数');
  function counts(from,to,mode) {
    // The launch day is a partial observation day, never pretend it is a full period.
    if(from<=startedDate)return {activeUsers:null,newUsers:null};
    const kept=mode==='retained',dayKey=kept?'keptDays':'rawDays',firstKey=kept?'firstKept':'firstRaw';
    return {activeUsers:visitors.filter(v=>v[dayKey].some(d=>d&&d>=from&&d<=to)).length,newUsers:visitors.filter(v=>v[firstKey]>=from&&v[firstKey]<=to).length};
  }
  function periods(unit,count) {
    let boundary=today;
    if(unit==='week')boundary=shift(today,-((new Date(today+'T00:00:00Z').getUTCDay()+6)%7));
    if(unit==='month')boundary=today.slice(0,7)+'-01';
    const result=[];
    for(let i=0;i<count;i++){const endDate=shift(boundary,-1),date=unit==='day'?endDate:unit==='week'?shift(boundary,-7):endDate.slice(0,7)+'-01';result.unshift({date,endDate,label:unit==='month'?date.slice(0,7):unit==='week'?`${date} 至 ${endDate}`:date});boundary=date;}
    return result;
  }
  const summaries=await collection.aggregate([{$match:{day:{$gte:shift(today,-7)}}},{$group:{_id:'$session',classification:{$first:'$classification'}}},{$group:{_id:'$classification',count:{$sum:1}}}],{maxTimeMS:5000,allowDiskUse:false}).toArray();
  const samples=await collection.aggregate([{$match:{day:{$gte:shift(today,-7)},classification:{$in:['high','watch']}}},{$sort:{updatedAt:-1}},{$group:{_id:'$session',day:{$first:'$day'},score:{$first:'$score'},classification:{$first:'$classification'},signals:{$first:'$signals'},pages:{$first:'$pages'}}},{$sort:{score:-1,day:-1}},{$limit:5},{$project:{_id:0,day:1,score:1,classification:1,signals:1,pages:1}}],{maxTimeMS:5000,allowDiskUse:false}).toArray();
  const views=Object.fromEntries(['raw','retained'].map(mode=>[mode,{rollingEndDate:today,rolling:Object.fromEntries([1,7,30].map(days=>[days,counts(shift(today,1-days),today,mode)])),trends:Object.fromEntries(Object.entries({day:14,week:8,month:6}).map(([unit,count])=>[unit,periods(unit,count).map(p=>({...p,...counts(p.date,p.endDate,mode)}))])),today:{activeUsers:visitors.filter(v=>v[mode==='raw'?'rawDays':'keptDays'].includes(today)).length,newUsers:visitors.filter(v=>v[mode==='raw'?'firstRaw':'firstKept']===today).length}}]));
  return {status:'connected',mode:'observe',ruleVersion:meta.ruleVersion,startedAt:start.toISOString(),startedDate,timeZone,sampledAt:new Date(now).toISOString(),endDate:shift(today,-1),observationDays:Math.min(7,Math.max(0,Math.floor((now-start.getTime())/86400000))),reviewReady:now-start.getTime()>=7*86400000,views,sessionCounts:Object.fromEntries(summaries.map(r=>[r._id,r.count])),samples};
}
