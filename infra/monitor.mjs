// Local capture only. Notification channel integration remains a release requirement.
import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateMonitor } from './monitor-rules.mjs';
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const endpoint = new URL(config.apiUrl);
if (endpoint.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(endpoint.hostname) || endpoint.username || endpoint.password) throw new Error('Monitoring requires a loopback API');
if (typeof config.secret !== 'string' || config.secret.length < 32) throw new Error('A dedicated monitor secret is required');
for (const key of ['stateFile','backupManifest','diskPath']) if (!path.isAbsolute(config[key])) throw new Error(`Absolute ${key} required`);
let state = {};
try { state = JSON.parse(await fs.readFile(config.stateFile,'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
let ready = false, metrics = null, backupAt = null;
try { ready = (await fetch(new URL('/health/ready',endpoint),{signal:AbortSignal.timeout(3000)})).ok; } catch { /* recorded as unavailable */ }
try { const response = await fetch(new URL('/health/metrics',endpoint),{headers:{'x-monitor-secret':config.secret},signal:AbortSignal.timeout(3000)}); if(response.ok) metrics=await response.json(); } catch { /* separate metrics alarm */ }
try { const manifest=JSON.parse(await fs.readFile(config.backupManifest,'utf8')); if(manifest.status==='success')backupAt=Date.parse(manifest.finishedAt); } catch { /* missing/corrupt manifest is stale */ }
const disk=await fs.statfs(config.diskPath), now=Date.now();
const result=evaluateMonitor({now,ready,metrics,backupAt,diskUsed:1-disk.bavail/disk.blocks},state);
await fs.mkdir(path.dirname(config.stateFile),{recursive:true});
await fs.writeFile(config.stateFile+'.tmp',JSON.stringify(result.state),{mode:0o600});
await fs.rename(config.stateFile+'.tmp',config.stateFile);
console.log(JSON.stringify({at:new Date(now).toISOString(),...result,metrics,delivery:'local-journal-only'}));
