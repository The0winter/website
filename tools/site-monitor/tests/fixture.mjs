import '../../test-env.cjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
export function workspace(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'site-monitor-test-'));execFileSync('git',['init','--quiet',root],{windowsHide:true});return root;}
export function removeWorkspace(root){const absolute=path.resolve(root);if(!absolute.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(absolute).startsWith('site-monitor-test-'))throw Error('Unsafe test path');fs.rmSync(absolute,{recursive:true,force:true});}
export function fixtureCollectors(){let n=0;return {
  server:async()=>({sampledAt:new Date(Date.now()+n++*15000).toISOString(),cpu:{idle:100+n*300,total:100+n*1000},cores:2,uptime:90000,load:[.2,.1,.1],memory:{total:4*1024**3,available:3*1024**3,swapTotal:2*1024**3,swapUsed:0},network:{rx:n*5000,tx:n*2000},disk:{total:40*1024**3,available:30*1024**3,free:30*1024**3,inodes:500000,freeInodes:400000},services:[{Id:'test1-api.service',ActiveState:'active',MemoryCurrent:'134217728',NRestarts:'0',MemoryMax:'805306368'}],api:{rss:134217728,databaseReady:true},backup:{status:'success',finishedAt:new Date().toISOString()},release:'synthetic-test-release'}),
  atlas:async()=>({sampledAt:new Date().toISOString(),pingMs:30,database:'synthetic_test',dataBytes:60*1024**2,indexBytes:8*1024**2,storageBytes:80*1024**2,objects:100000,collections:20,indexes:40,cluster:{logicalBytes:80*1024**2,databases:2}}),
  r2:async()=>({sampledAt:new Date().toISOString(),buckets:[{id:'chapters',bucket:'synthetic-chapters',label:'正文',status:'ok',latencyMs:50},{id:'covers',bucket:'synthetic-covers',label:'封面',status:'ok',latencyMs:40}]}),
  site:async()=>({sampledAt:new Date().toISOString(),status:200,latencyMs:200,url:'https://example.test'})
};}
