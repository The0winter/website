// Executed remotely with a read-only database connection; returns aggregates only.
export async function readBusiness(db, request = {}, now = Date.now()) {
  const sampledAt=new Date(now).toISOString();
  const days=[7,30,90].includes(request.days)?request.days:30;
  const timeZone='Asia/Shanghai',today=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  const shift=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const startDate=shift(-days),endDate=shift(-1),previousStart=shift(-days*2);
  const query=(name,pipeline)=>db.collection(name).aggregate(pipeline,{maxTimeMS:5000,allowDiskUse:false}).toArray();
  const genuine={$max:[0,{$subtract:[{$ifNull:['$views',0]},{$ifNull:['$baselineViews',0]}]}]};
  const publicBooks=[{$lookup:{from:'books',localField:'_id',foreignField:'_id',as:'book'}},{$unwind:'$book'},{$match:{'book.deletedAt':null,'book.visibility':{$ne:'private'}}}];
  const [totalUsers,registrations,unknownDates,reads,topBooks,bookmarks]=await Promise.all([
    db.collection('users').countDocuments({},{maxTimeMS:5000}),
    query('users',[{$match:{created_at:{$type:'date',$gte:new Date(shift(-400)+'T00:00:00+08:00'),$lt:new Date(shift(1)+'T00:00:00+08:00')}}},{$group:{_id:{$dateToString:{date:'$created_at',format:'%Y-%m-%d',timezone:timeZone}},count:{$sum:1}}},{$sort:{_id:1}}]),
    db.collection('users').countDocuments({created_at:{$not:{$type:'date'}}},{maxTimeMS:5000}),
    query('readdailies',[{$match:{day:{$gte:previousStart,$lt:today}}},{$group:{_id:'$day',views:{$sum:genuine},baseline:{$sum:{$ifNull:['$baselineViews',0]}}}},{$sort:{_id:1}}]),
    query('readdailies',[{$match:{day:{$gte:startDate,$lt:today}}},{$group:{_id:'$bookId',views:{$sum:genuine}}},{$match:{views:{$gt:0}}},...publicBooks,{$sort:{views:-1,_id:1}},{$limit:10},{$project:{_id:0,id:{$toString:'$_id'},title:'$book.title',views:1}}]),
    query('bookmarks',[{$group:{_id:'$bookId',count:{$sum:1}}},...publicBooks,{$sort:{count:-1,_id:1}},{$limit:10},{$project:{_id:0,id:{$toString:'$_id'},title:'$book.title',count:1}}]),
  ]);
  const reg=new Map(registrations.map(r=>[r._id,r.count])),read=new Map(reads.map(r=>[r._id,r.views]));
  const sum=(rows,field,from,to)=>rows.filter(r=>r._id>=from&&r._id<to).reduce((n,r)=>n+r[field],0);
  return {sampledAt,days,timeZone,startDate,endDate,todayDate:today,totalUsers,unknownRegistrationDates:unknownDates,todayNewUsers:reg.get(today)||0,
    registrationHistory:registrations.map(r=>({date:r._id,newUsers:r.count})),
    current:{newUsers:sum(registrations,'count',startDate,today),reads:sum(reads,'views',startDate,today)},
    previous:{newUsers:sum(registrations,'count',previousStart,startDate),reads:sum(reads,'views',previousStart,startDate)},
    daily:Array.from({length:days},(_,i)=>{const date=shift(-days+i);return {date,newUsers:reg.get(date)||0,reads:read.get(date)||0};}),
    topBooks,bookmarks,excludedBaseline:sum(reads,'baseline',startDate,today)};
}
