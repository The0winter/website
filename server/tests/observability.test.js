import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestMetrics,allowMetrics} from '../services/observability.js';
import {evaluateMonitor} from '../../infra/monitor-rules.mjs';
test('metrics expire bounded buckets and reject absent, remote or forged monitor credentials',()=>{
  let now=0;const metrics=createRequestMetrics(()=>now);
  metrics.record(200);metrics.record(503);assert.equal(metrics.snapshot().buckets[0].errors,1);
  now=360000;metrics.record(200);assert.equal(metrics.snapshot().buckets.length,1);
  process.env.MONITOR_SECRET='m'.repeat(48);
  const request={socket:{remoteAddress:'127.0.0.1'},headers:{'x-monitor-secret':process.env.MONITOR_SECRET}};
  assert.equal(allowMetrics(request),true);
  assert.equal(allowMetrics({...request,socket:{remoteAddress:'192.0.2.1'}}),false);
  assert.equal(allowMetrics({...request,headers:{'x-monitor-secret':'错'.repeat(48)}}),false);
  delete process.env.MONITOR_SECRET;assert.equal(allowMetrics(request),false);
});
test('monitor enforces outage, error volume, disk and backup thresholds and reports recovery',()=>{
  const now=600000, healthy={now,ready:true,metrics:{buckets:[]},backupAt:now,diskUsed:0.2};
  let result=evaluateMonitor({...healthy,ready:false});assert.deepEqual(result.alerts,[]);
  result=evaluateMonitor({...healthy,now:now+60000,ready:false},result.state);assert.deepEqual(result.alerts,['service-unavailable']);
  result=evaluateMonitor({...healthy,now:now+60001},result.state);assert.deepEqual(result.alerts,[]);assert.equal(result.changed,true);
  const buckets=Array.from({length:5},(_,i)=>({minute:5+i,requests:20,errors:i===0?2:0}));
  assert.deepEqual(evaluateMonitor({...healthy,metrics:{buckets}}).alerts,['http-5xx']);
  assert.deepEqual(evaluateMonitor({...healthy,metrics:{buckets:buckets.slice(1)}}).alerts,[]);
  assert.deepEqual(evaluateMonitor({...healthy,backupAt:null,diskUsed:0.81}).alerts,['disk-space','backup-stale']);
});
