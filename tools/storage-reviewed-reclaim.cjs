// Explicit, audited class-3 cleanup. Automatic maintenance never selects this mode.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {gunzipSync} = require('node:zlib');
const maintenance = () => require('./storage-maintenance.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const norm = value => value.replaceAll('\\', '/').toLowerCase();
const category = type => ({dependency:'clean-room', build:'build', visual:'artifacts', browser:'browser-cache', temporary:'temp', partial:'crawler-cache', cache:'crawler-cache'})[type];

function typeFor(relative, reason) {
  if (relative.split('/').some(name => /^\.env(?:\.|$)|^\.storage-keep$|^\.npmrc$|^\.pypirc$/i.test(name)) || /^(?:Cookies|Login Data|Local State)$/i.test(path.posix.basename(relative)) || /\.(?:pem|key|pfx|p12)$/i.test(relative)) return null;
  if (reason === 'dependency' && /(?:^|\/)node_modules\//.test(relative)) return 'dependency';
  if (reason === 'dependency' && /^\.runtime\/(?:node-v[\d.]+-win-x64|mongodb-database-tools-windows-x86_64-[\d.]+|nginx-[\d.]+)\//.test(relative)) {
    // Local nginx configuration may have been customized; keep it with the source.
    if (/\/conf\//.test(relative)) return null;
    return 'dependency';
  }
  if (reason === 'build' && /(?:^|\/)\.next(?:-[a-z0-9-]+)?\//.test(relative) && /^(?:web-next\/|\.runtime\/|\.next\/)/.test(relative)) return 'build';
  if (reason === 'visual' && /^(?:artifacts\/|web-next\/(?:artifacts|test-results)\/|test-results\/|\.runtime\/)/.test(relative) && /\.(?:png|log)$/.test(relative)) return 'visual';
  if (reason === 'temp-cache' && /^(?:browser_data\/|\.novel-crawler\/|\.runtime\/)/.test(relative) && /\/(?:Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|DawnCache)\//.test(relative)) return 'browser';
  if (reason === 'temp-cache' && /^\.runtime\/test-tmp\/(?:node-compile-cache|playwright-transform-cache|python-cache|npm-cache|playwright_chromiumdev_profile-[A-Za-z0-9]+|novel-browser-[A-Za-z0-9]+)\//.test(relative) && !/\/(?:Local Storage|Session Storage|Network)\//.test(relative)) return 'temporary';
  if (reason === 'duplicate-partial' && /^\.novel-crawler\/jobs\/[a-f0-9]{20}\/partial\.json$/.test(relative)) return 'partial';
  if (reason === 'loose-cache' && /^\.novel-crawler\/cache\/[a-f0-9]{64}\.(?:json|bin)$/.test(relative)) return 'cache';
  return null;
}

function ancestors(processes) {
  const parents = new Map(processes.map(p => [p.pid,p.parent])), ids = new Set();
  for (let pid of [process.pid,process.ppid]) while (Number.isInteger(pid) && pid > 0 && !ids.has(pid)) {
    ids.add(pid); pid = parents.get(pid);
  }
  return ids;
}
function toolHosts(root, processes) {
  const byId = new Map(processes.map(p => [p.pid,p])), hosts = new Set(), project = norm(root);
  for (const p of processes) {
    const command = norm(p.command || '');
    if (!command.includes('/openai/codex/runtimes/cua_node/') || command.includes(project)) continue;
    if (/\/(?:\.tmp[^/ ]+\/(?:kernel|trusted-worker)\.js|cua-repl\/bin\/cua-repl\.mjs)(?:[" ]|$)/.test(command)) { hosts.add(p.pid); continue; }
    const parent = byId.get(p.parent), grandparent = byId.get(parent?.parent), launch = norm(parent?.command || '');
    if (/\.\/server\.mjs(?:[" ]|$)/.test(command) && /^cmd(?:\.exe)?$/i.test(parent?.name || '') && /^codex(?:\.exe)?$/i.test(grandparent?.name || '') && !launch.includes(project) && /(?:^|[/ "'])launch_(?:codex_app_tools|code_review)_mcp\.cmd(?:[" '\t]|$)/.test(launch)) hosts.add(p.pid);
  }
  return hosts;
}
function activityError(root, types, relative, processes, busy, own = ancestors(processes), hosts = toolHosts(root,processes)) {
  if (busy.has('all')) return 'An unknown or unreadable runtime is active';
  for (const type of types) if (busy.has(category(type)) || (type === 'partial' && busy.has('snapshots'))) return 'An active task protects this category';
  const absolute = norm(path.resolve(root, relative));
  for (const p of processes) {
    if (own.has(p.pid) || hosts.has(p.pid) || typeof p.command !== 'string') continue;
    const command = norm(p.command);
    if (command.includes('/openai/codex/runtimes/cua_node/') && /\/\.tmp[^/ ]+\/(?:kernel|trusted-worker)\.js(?:[" ]|$)/.test(command)) continue;
    if (command.includes(absolute)) return 'Path referenced by an active process';
    if (types.includes('dependency') && (/^(?:node|mongod|nginx)(?:\.exe)?$/i.test(p.name || '') || /(?:^|[/ "-])(?:node|mongod|nginx)(?:\.exe)?(?:[" ]|$)/.test(command))) return 'Installed dependencies/toolchains are protected while another runtime is active';
    if (types.includes('browser') || (types.includes('temporary') && /^\.runtime\/test-tmp\/(?:playwright_chromiumdev_profile-|novel-browser-)/.test(relative))) {
      const beforeDefault = relative.split('/Default/')[0];
      const profile = /^\.runtime\/test-tmp\/(?:playwright_chromiumdev_profile-|novel-browser-)/.test(relative) ? relative.split('/').slice(0,3).join('/') : beforeDefault === relative ? relative.split(/\/(?:Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|DawnCache)(?:\/|$)/)[0] : beforeDefault;
      if (command.includes(norm(path.resolve(root, profile)))) return 'Browser profile is in use';
    }
  }
  return null;
}
function partialProof(root, record) {
  const api = maintenance();
  if (!record.duplicate || !/^downloads\/[^/]+\.json$/.test(record.duplicate.path) || !/^[a-f0-9]{64}$/.test(record.duplicate.sha256)) throw Error('Missing verified export duplicate');
  const a = fs.readFileSync(api.inside(root, record.path)), b = fs.readFileSync(api.inside(root, record.duplicate.path));
  if (sha(a) !== record.duplicate.sha256 || !a.equals(b)) throw Error('Intermediate book no longer equals the retained export');
  const references=new Set();
  function collect(value,key) {
    if(key==='content')return;
    if(typeof value==='string')for(const match of value.matchAll(/\b[a-f0-9]{64}\b/g))references.add(match[0]);
    else if(value && typeof value==='object')for(const [name,child] of Object.entries(value))collect(child,name);
  }
  collect(JSON.parse(a.toString('utf8')));
  return {proof:record.duplicate,references};
}

function plan(root, {reviewed, expectedReview, processes, tracked, check}) {
  const api = maintenance();
  if (!/^\.runtime\/task-artifacts\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.json\.gz$/.test(reviewed || '')) throw Error('Reviewed manifest must be inside a named task-artifacts directory');
  const raw = fs.readFileSync(api.inside(root, reviewed)), reviewHash = sha(raw);
  if (expectedReview && expectedReview !== reviewHash) throw Error('Reviewed manifest changed after preview');
  const manifest = JSON.parse(gunzipSync(raw, {maxOutputLength:128 * 1024 ** 2}).toString('utf8'));
  if (manifest.version !== 1 || manifest.classification !== 3 || !Array.isArray(manifest.files) || manifest.files.length > 250000) throw Error('Invalid class-3 manifest');
  const blockers = [], busy = api.busyCategories(root, processes, blockers), trackedSet = new Set(tracked), checkedParents = new Set(), own = ancestors(processes), hosts = toolHosts(root,processes);
  const records = new Map(), approved = new Map(), protectedPaths = [], missing = [], pinCache = new Map();
  const protectedPath = (relative, reason) => protectedPaths.push({path:relative,reason});
  function pinned(relative) {
    const parent = path.posix.dirname(relative);
    if (pinCache.has(parent)) return pinCache.get(parent);
    let result = false;
    for (let p = parent; p && p !== '.'; p = path.posix.dirname(p)) if (fs.existsSync(api.inside(root, p + '/.storage-keep'))) { result = true; break; }
    result ||= fs.existsSync(path.join(root, '.storage-keep'));
    pinCache.set(parent,result); return result;
  }
  for (const record of manifest.files) {
    check();
    if (!record || typeof record.path !== 'string' || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || !Number.isFinite(record.mtimeMs)) throw Error('Invalid reviewed file record');
    api.inside(root,record.path,checkedParents);
    if (records.has(record.path)) throw Error('Duplicate reviewed path');
    records.set(record.path,record);
    try {
      const type = typeFor(record.path,record.reason);
      if (!type || trackedSet.has(record.path) || pinned(record.path)) throw Error('Not an eligible untracked, unpinned class-3 file');
      const stat = fs.lstatSync(api.inside(root,record.path,checkedParents));
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Not an ordinary file');
      if (stat.size !== record.bytes || Math.abs(stat.mtimeMs-record.mtimeMs) > 3) throw Error('Changed since the audit');
      const active = activityError(root,[type],record.path,processes,busy,own,hosts); if (active) throw Error(active);
      const verified = type === 'partial' ? partialProof(root,record) : undefined;
      approved.set(record.path,{type,proof:verified?.proof,references:verified?.references});
    } catch (error) {
      if (error.code === 'ENOENT') missing.push(record.path); else protectedPath(record.path,error.message);
    }
  }
  // Re-evaluate official references once per plan; never trust an audit's old list.
  const rawCache = [...approved].filter(([,v])=>v.type==='cache'), partials=[...approved].filter(([,v])=>v.type==='partial');
  if (rawCache.length || partials.length) {
    let evidence;
    try { evidence = api.evidenceHashes(root,check,{exclude:new Set(partials.map(([relative])=>relative))}); }
    catch (error) { if (error.code==='STORAGE_YIELD') throw error; for (const [relative] of [...rawCache,...partials]) { approved.delete(relative); protectedPath(relative,'Evidence references could not be verified'); } }
    if(evidence) {
      // Do not make an original response collectible by removing its sole durable
      // reference. Retained partials also continue to protect their cache objects.
      const retained=partials.filter(([,value])=>[...value.references].some(hash=>!evidence.has(hash)));
      for(const [relative,value] of retained) {approved.delete(relative);protectedPath(relative,'Intermediate book contains evidence references absent from the retained metadata');}
      for(const [,value] of retained)for(const hash of value.references)evidence.add(hash);
    }
    if (evidence) for (const [relative] of rawCache) {
      const stem = relative.replace(/\.(?:json|bin)$/,''), metaPath=stem+'.json', bodyPath=stem+'.bin';
      try {
        if (!approved.has(metaPath) || !approved.has(bodyPath)) throw Error('Both unchanged cache members must be reviewed');
        const meta = JSON.parse(fs.readFileSync(api.inside(root,metaPath),'utf8'));
        if (!/^[a-f0-9]{64}$/.test(meta.hash) || evidence.has(meta.hash)) throw Error('Original page is now referenced or has invalid metadata');
        if (sha(fs.readFileSync(api.inside(root,bodyPath)))!==meta.hash) throw Error('Cache body does not match its evidence hash');
      } catch (error) { for (const p of [metaPath,bodyPath]) if (approved.delete(p)) protectedPath(p,error.message); }
    }
  }
  // Only collapse a directory when every current child is an approved file or
  // subtree. A new/unreviewed child prevents recursive removal of its parent.
  const tree = {children:new Map()};
  for (const [relative,value] of approved) {
    let node=tree;
    for (const component of relative.split('/')) { if (!node.children.has(component)) node.children.set(component,{children:new Map()}); node=node.children.get(component); }
    node.value=value;
  }
  function collapse(node,relative) {
    check();
    if (node.value) return [{path:relative,reviewedTypes:[node.value.type],reviewedProof:node.value.proof,merge:!['cache','partial'].includes(node.value.type)}];
    const selected=[...node.children].flatMap(([name,child])=>collapse(child,relative ? relative+'/'+name : name));
    if (!relative || !selected.length || !selected.every(x=>x.merge)) return selected;
    try {
      const entries=fs.readdirSync(api.inside(root,relative),{withFileTypes:true});
      if (entries.length===node.children.size && entries.every(e=>!e.isSymbolicLink() && node.children.has(e.name)) && selected.every(x=>path.posix.dirname(x.path)===relative)) {
        return [{path:relative,reviewedTypes:[...new Set(selected.flatMap(x=>x.reviewedTypes))],merge:true}];
      }
    } catch { /* Keep independently reviewed children; no inferred parent deletion. */ }
    return selected;
  }
  const candidates=[];
  for (const item of collapse(tree,'')) {
    try { const {merge,...review}=item; candidates.push({...api.snapshot(root,item.path,tracked,undefined,check),...review,category:category(item.reviewedTypes[0])}); }
    catch (error) { if (error.code==='STORAGE_YIELD') throw error; protectedPath(item.path,error.message); }
  }
  // Cache bodies must disappear first; execute() retains metadata if body removal fails.
  candidates.sort((a,b)=>(a.path.endsWith('.bin')?-1:0)-(b.path.endsWith('.bin')?-1:0) || a.path.localeCompare(b.path));
  return {root,scope:'reviewed',reviewed,reviewHash,createdAt:new Date().toISOString(),candidates,bytes:candidates.reduce((n,x)=>n+x.bytes,0),busy:[...busy],blockers,protectedPaths,missing,warnings:[],reviewedFileCount:manifest.files.length};
}

function recheck(root,item,processes) {
  const api=maintenance(), busy=api.busyCategories(root,processes);
  const error=activityError(root,item.reviewedTypes || [],item.path,processes,busy); if (error) throw Error(error);
  if (item.reviewedTypes?.includes('partial')) partialProof(root,{path:item.path,duplicate:item.reviewedProof});
}
module.exports={plan,recheck,typeFor,activityError};
