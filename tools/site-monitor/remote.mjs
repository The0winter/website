// Sent over SSH stdin. This worker issues read-only commands and never writes files.
export async function remoteSnapshot(kind, request = {}, readBusiness, readTraffic) {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const {execFile} = await import('node:child_process');
  const {promisify} = await import('node:util');
  const {pathToFileURL} = await import('node:url');
  const root = '/srv/test1/current/server';
  const load = name => import(pathToFileURL(`${root}/${name}`).href);
  const sampledAt = new Date().toISOString();
  if (kind === 'server') {
    const mem = Object.fromEntries((await fs.readFile('/proc/meminfo', 'utf8')).trim().split('\n').map(line => {const [key, value] = line.split(':'); return [key, Number(value.trim().split(' ')[0]) * 1024];}));
    const cpu = os.cpus().reduce((sum, row) => ({idle: sum.idle + row.times.idle, total: sum.total + Object.values(row.times).reduce((a, b) => a + b, 0)}), {idle:0,total:0});
    const network = (await fs.readFile('/proc/net/dev','utf8')).split('\n').slice(2).reduce((sum, line) => {
      const [name, rest] = line.split(':'); if (!rest || name.trim() === 'lo') return sum;
      const values = rest.trim().split(/\s+/).map(Number); return {rx:sum.rx + values[0], tx:sum.tx + values[8]};
    }, {rx:0,tx:0});
    const stat = await fs.statfs('/srv/test1');
    let services = [], api = null, backup = null;
    try {
      const {stdout} = await promisify(execFile)('systemctl',['show','test1-api.service','test1-web.service','nginx.service','test1-atlas-backup.timer','test1-cover-cleanup.timer','test1-release-prune.timer','--property=Id,ActiveState,SubState,NRestarts,MemoryCurrent,MemoryMax'],{timeout:5000,maxBuffer:32768});
      services = stdout.trim().split(/\n\n+/).map(block => Object.fromEntries(block.split('\n').map(line => {const i=line.indexOf('='); return [line.slice(0,i),line.slice(i+1)];})));
    } catch { /* partial state remains explicitly unavailable */ }
    try { const r=await fetch('http://127.0.0.1:5000/health/metrics',{headers:{'x-monitor-secret':process.env.MONITOR_SECRET||''},signal:AbortSignal.timeout(4000)}); if(r.ok){const m=await r.json();api={rss:m.rss,heapUsed:m.heapUsed,uptimeSeconds:m.uptimeSeconds,databaseReady:m.databaseReady,buckets:m.buckets};} } catch {}
    try {const m=JSON.parse(await fs.readFile('/var/lib/test1-atlas-backup/latest.json','utf8'));backup={status:m.status,finishedAt:m.finishedAt,createdAt:m.createdAt,size:m.size??m.bytes};} catch {}
    return {sampledAt,cpu,cores:os.cpus().length,uptime:os.uptime(),load:os.loadavg(),memory:{total:mem.MemTotal,available:mem.MemAvailable,swapTotal:mem.SwapTotal,swapUsed:mem.SwapTotal-mem.SwapFree},network,disk:{total:stat.blocks*stat.bsize,available:stat.bavail*stat.bsize,free:stat.bfree*stat.bsize,inodes:stat.files,freeInodes:stat.ffree},services,api,backup,release:(await fs.realpath('/srv/test1/current')).split('/').pop()};
  }
  if (kind === 'atlas' || kind === 'business' || kind==='traffic') {
    const mongoose=(await load('node_modules/mongoose/index.js')).default;
    const uri=process.env.DATABASE_URL||process.env.MONGO_URI;
    if(!uri?.startsWith('mongodb'))throw Error('DATABASE_NOT_MONGODB');
    const connection=await mongoose.createConnection(uri,{maxPoolSize:1,autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:7000,connectTimeoutMS:7000,socketTimeoutMS:10000}).asPromise();
    try {
      if(kind==='business')return await readBusiness(connection.db,request);
      if(kind==='traffic')return await readTraffic(connection.db,request);
      const start=Date.now();await connection.db.command({ping:1});const pingMs=Date.now()-start;
      const stats=await connection.db.command({dbStats:1,scale:1});
      let cluster=null;try{const s=await connection.db.command({atlasSize:1});cluster={logicalBytes:s.atlasSize,dataBytes:s.totals?.dataSize,indexBytes:s.totals?.indexSize,databases:s.totals?.numDatabases};}catch{}
      return {sampledAt,pingMs,database:stats.db,dataBytes:stats.dataSize,indexBytes:stats.indexSize,storageBytes:stats.storageSize,objects:stats.objects,collections:stats.collections,indexes:stats.indexes,cluster};
    } finally {await connection.close();}
  }
  if (kind === 'r2' || kind === 'inventory') {
    const {S3Client,HeadBucketCommand,ListObjectsV2Command}=await load('node_modules/@aws-sdk/client-s3/dist-cjs/index.js');
    const configs=[{id:'chapters',label:'正文、草稿与备份',bucket:process.env.R2_BUCKET,endpoint:process.env.R2_ENDPOINT,key:process.env.R2_ACCESS_KEY_ID,secret:process.env.R2_SECRET_ACCESS_KEY},{id:'covers',label:'书籍封面',bucket:process.env.COVER_R2_BUCKET,endpoint:process.env.COVER_R2_ENDPOINT,key:process.env.COVER_R2_ACCESS_KEY_ID,secret:process.env.COVER_R2_SECRET_ACCESS_KEY}];
    async function read(config) {
      if(!config.bucket||!config.key||!config.secret)return {id:config.id,label:config.label,status:'unconfigured'};
      const endpoint=new URL(config.endpoint);
      if(endpoint.protocol!=='https:'||!/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname))throw Error('INVALID_R2_ENDPOINT');
      const client=new S3Client({region:'auto',endpoint:endpoint.origin,credentials:{accessKeyId:config.key,secretAccessKey:config.secret},maxAttempts:1});
      try {
        if(kind==='r2'){const start=Date.now();await client.send(new HeadBucketCommand({Bucket:config.bucket}),{abortSignal:AbortSignal.timeout(8000)});return {id:config.id,label:config.label,bucket:config.bucket,status:'ok',latencyMs:Date.now()-start};}
        let cursor=request.cursor||undefined,bytes=0,objects=0,pages=0,complete=false;
        const groups={};
        for(;pages<10;){
          const result=await client.send(new ListObjectsV2Command({Bucket:config.bucket,MaxKeys:1000,ContinuationToken:cursor}),{abortSignal:AbortSignal.timeout(8000)});
          for(const obj of result.Contents||[]){bytes+=Number(obj.Size)||0;objects++;const prefix=['chapters','drafts','backups','covers'].includes(obj.Key?.split('/')[0])?obj.Key.split('/')[0]:'other';groups[prefix]??={bytes:0,objects:0};groups[prefix].bytes+=Number(obj.Size)||0;groups[prefix].objects++;}
          pages++;cursor=result.NextContinuationToken;
          if(!result.IsTruncated){complete=true;cursor=null;break;}
          if(!cursor)throw Error('MISSING_CURSOR');
          await new Promise(r=>setTimeout(r,150));
        }
        return {id:config.id,bucket:config.bucket,bytes,objects,pages,groups,cursor,complete,sampledAt};
      }catch {return {id:config.id,label:config.label,bucket:config.bucket,status:'error'};}
      finally {client.destroy();}
    }
    if(kind==='inventory'){
      const config=configs.find(x=>x.id===request.bucket);if(!config)throw Error('INVALID_BUCKET');return read(config);
    }
    return {sampledAt,buckets:await Promise.all(configs.map(read))};
  }
  throw Error('UNKNOWN_SNAPSHOT');
}
