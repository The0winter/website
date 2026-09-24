export const intervals={server:15000,atlas:60000,r2:300000,site:60000,business:900000,analytics:900000,realtime:60000};
const empty=()=>({data:null,history:[],status:'pending',error:null,busy:false,lastAttempt:null,lastSuccess:null,nextDue:0});
export class MonitorSession {
  constructor(collect, {clock=Date.now,maxPoints=1440}={}) {
    this.collect=collect;this.clock=clock;this.maxPoints=maxPoints;this.startedAt=clock();this.closed=false;this.paused=false;
    this.modules=Object.fromEntries(Object.keys(collect).map(key=>[key,empty()]));
    this.inflight=new Map();
  }
  start(){this.refresh();this.timer=setInterval(()=>this.tick(),1000);this.timer.unref();}
  tick(){if(this.closed||this.paused)return;for(const key of Object.keys(this.modules))if(this.modules[key].nextDue<=this.clock())void this.refresh(key);}
  refresh(key){
    if(this.closed)return Promise.resolve();
    if(!key)return Promise.all(Object.keys(this.modules).map(name=>this.refresh(name)));
    if(!this.modules[key])throw Error('未知模块');
    if(this.inflight.has(key))return this.inflight.get(key).promise;
    const state=this.modules[key],controller=new AbortController();state.busy=true;state.lastAttempt=this.clock();
    const promise=Promise.resolve().then(()=>this.collect[key](controller.signal)).then(data=>{
      if(this.closed||controller.signal.aborted)return;
      const old=state.data,now=this.clock();
      if(key==='server'){
        const dt=old?(Date.parse(data.sampledAt)-Date.parse(old.sampledAt))/1000:0;
        const delta=old?data.cpu.total-old.cpu.total:0,idle=old?data.cpu.idle-old.cpu.idle:0;
        data.cpuPercent=delta>0&&idle>=0&&idle<=delta?100*(1-idle/delta):null;
        data.rxPerSecond=dt>0&&data.network.rx>=old.network.rx?(data.network.rx-old.network.rx)/dt:null;
        data.txPerSecond=dt>0&&data.network.tx>=old.network.tx?(data.network.tx-old.network.tx)/dt:null;
      }
      state.data=data;state.status='ok';state.error=null;state.lastSuccess=now;
      const point={at:now};
      if(key==='server')Object.assign(point,{cpu:data.cpuPercent,memory:100*(1-data.memory.available/data.memory.total),disk:100*(1-data.disk.available/data.disk.total),rx:data.rxPerSecond,tx:data.txPerSecond});
      if(key==='atlas')Object.assign(point,{logical:data.cluster?.logicalBytes??data.dataBytes+data.indexBytes,ping:data.pingMs});
      if(key==='site')point.latency=data.latencyMs;
      state.history.push(point);if(state.history.length>this.maxPoints)state.history.splice(0,state.history.length-this.maxPoints);
    }).catch(error=>{if(!this.closed&&!controller.signal.aborted){state.status='error';state.error=error.message;state.history.push({at:this.clock(),gap:true});if(state.history.length>this.maxPoints)state.history.shift();}})
      .finally(()=>{state.busy=false;state.nextDue=this.clock()+intervals[key];this.inflight.delete(key);});
    this.inflight.set(key,{controller,promise});return promise;
  }
  async reset(keys,collect){for(const key of keys)this.inflight.get(key)?.controller.abort();await Promise.allSettled(keys.map(key=>this.inflight.get(key)?.promise));if(this.closed)return;for(const key of keys){this.collect[key]=collect[key];this.modules[key]=empty();}await Promise.all(keys.map(key=>this.refresh(key)));}
  snapshot(){const now=this.clock();return {version:2,startedAt:this.startedAt,now,paused:this.paused,maxPoints:this.maxPoints,modules:Object.fromEntries(Object.entries(this.modules).map(([k,v])=>[k,{...v,interval:intervals[k],stale:v.lastSuccess!==null&&now-v.lastSuccess>intervals[k]*2}]))};}
  async close(){this.closed=true;clearInterval(this.timer);for(const x of this.inflight.values())x.controller.abort();await Promise.allSettled([...this.inflight.values()].map(x=>x.promise));}
}
