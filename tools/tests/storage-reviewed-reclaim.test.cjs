require('../test-env.cjs');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const crypto=require('node:crypto'), {gzipSync}=require('node:zlib');
const test=require('node:test'), assert=require('node:assert/strict');
const {plan,execute,maintain}=require('../storage-maintenance.cjs');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'storage-reviewed-'));
  fs.mkdirSync(path.join(root,'.git'));
  t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const options={processes:[],tracked:[],reviewed:'.runtime/task-artifacts/review/files.json.gz'};
  function put(relative,body='output') {const f=path.join(root,relative);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,body);return f;}
  function entry(relative,reason,duplicate) {const s=fs.statSync(path.join(root,relative));return {path:relative,bytes:s.size,mtimeMs:s.mtimeMs,reason,duplicate};}
  function review(entries) {put(options.reviewed,gzipSync(JSON.stringify({version:1,classification:3,files:entries})));return plan(root,options);}
  return {root,put,entry,review,options};
}
test('only audited ordinary files are removed; unreviewed siblings and business files survive',t=>{
  const f=fixture(t);f.put('node_modules/pkg/a.js');f.put('node_modules/pkg/private.txt','not reviewed');f.put('downloads/book.json','unique');
  const p=f.review([f.entry('node_modules/pkg/a.js','dependency'),f.entry('downloads/book.json','dependency')]);
  assert.deepEqual(p.candidates.map(x=>x.path),['node_modules/pkg/a.js']);
  assert.equal(execute(f.root,p,f.options).deleted.length,1);
  assert.equal(fs.readFileSync(path.join(f.root,'downloads/book.json'),'utf8'),'unique');
  assert.ok(fs.existsSync(path.join(f.root,'node_modules/pkg/private.txt')));
});
test('changed, tracked, pinned and secret files are protected; eligible complete trees collapse',t=>{
  const f=fixture(t);for(const name of ['good','changed','tracked','pinned'])f.put('node_modules/'+name+'/a.js');
  f.put('node_modules/secret/.env','credential');f.put('node_modules/pinned/.storage-keep','preserve');
  const entries=['good','changed','tracked','pinned'].map(n=>f.entry('node_modules/'+n+'/a.js','dependency'));
  entries.push(f.entry('node_modules/secret/.env','dependency'));f.put('node_modules/changed/a.js','changed bytes');f.options.tracked=['node_modules/tracked/a.js'];
  const p=f.review(entries);assert.deepEqual(p.candidates.map(x=>x.path),['node_modules/good']);assert.equal(p.protectedPaths.length,4);
});
test('a newly created child between preview and removal prevents recursive deletion',t=>{
  const f=fixture(t);f.put('node_modules/pkg/a.js');const p=f.review([f.entry('node_modules/pkg/a.js','dependency')]);
  f.put('node_modules/pkg/new.js','new user file');const r=execute(f.root,p,f.options);
  assert.equal(r.deleted.length,0);assert.equal(r.skipped.length,1);assert.ok(fs.existsSync(path.join(f.root,'node_modules/pkg/new.js')));
});
test('another runtime protects dependencies and new activity is checked again before removal',t=>{
  const f=fixture(t);f.put('node_modules/pkg/a.js');const entries=[f.entry('node_modules/pkg/a.js','dependency')];const p=f.review(entries);
  const busy={...f.options,processes:[{pid:999999,parent:0,name:'node.exe',command:'node another-project.mjs'}]};
  assert.equal(plan(f.root,busy).candidates.length,0);assert.equal(execute(f.root,p,busy).deleted.length,0);
});
test('duplicate partials require current byte equality and retain their exports',t=>{
  const f=fixture(t),partial='.novel-crawler/jobs/'+'a'.repeat(20)+'/partial.json',exported='downloads/book.json';
  f.put(partial,'{"chapters":[]}');f.put(exported,'{"chapters":[]}');
  const proof={path:exported,sha256:digest('{"chapters":[]}')};const p=f.review([f.entry(partial,'duplicate-partial',proof)]);
  assert.equal(p.candidates.length,1);f.put(exported,'{"chapters":[1]}');assert.equal(execute(f.root,p,f.options).deleted.length,0);
  f.put(exported,'{"chapters":[]}');const fresh=plan(f.root,f.options);assert.equal(execute(f.root,fresh,f.options).deleted.length,1);assert.ok(fs.existsSync(path.join(f.root,exported)));
});
test('cache references are refreshed and both members must be unchanged and audited',t=>{
  const f=fixture(t),stem='.novel-crawler/cache/'+'b'.repeat(64),hash=digest('page');
  f.put(stem+'.bin','page');f.put(stem+'.json',JSON.stringify({hash}));
  const entries=[f.entry(stem+'.bin','loose-cache'),f.entry(stem+'.json','loose-cache')];const p=f.review(entries);assert.equal(p.candidates.length,2);
  f.put('.novel-crawler/jobs/job/chapters/one.json',JSON.stringify({provenance:[{hash}]}));assert.equal(execute(f.root,p,f.options).deleted.length,0);
  f.put('.novel-crawler/jobs/job/chapters/one.json','{}');assert.equal(f.review(entries.slice(0,1)).candidates.length,0);
});
test('malformed evidence protects raw pages rather than interpreting them as unreferenced',t=>{
  const f=fixture(t),stem='.novel-crawler/cache/'+'c'.repeat(64);f.put(stem+'.bin','body');f.put(stem+'.json',JSON.stringify({hash:digest('body')}));f.put('.novel-crawler/sources.json','broken');
  const p=f.review([f.entry(stem+'.bin','loose-cache'),f.entry(stem+'.json','loose-cache')]);assert.equal(p.candidates.length,0);assert.equal(p.protectedPaths.length,2);
});
test('removing a duplicate intermediate never discards the sole durable raw-page reference',t=>{
  const f=fixture(t),partial='.novel-crawler/jobs/'+'d'.repeat(20)+'/partial.json',exported='downloads/book.json',hash='e'.repeat(64);
  const body=JSON.stringify({chapters:[{content:'text',provenance:[{hash}]}]});f.put(partial,body);f.put(exported,body);
  const entry=f.entry(partial,'duplicate-partial',{path:exported,sha256:digest(body)});
  assert.equal(f.review([entry]).candidates.length,0);
  f.put('.novel-crawler/jobs/job/chapters/one.json',JSON.stringify({chapter:{provenance:[{hash}]}}));
  assert.equal(f.review([entry]).candidates.length,1);
});
test('manifest changes, traversal and linked ancestors fail closed',t=>{
  const f=fixture(t);f.put('node_modules/pkg/a.js');const entries=[f.entry('node_modules/pkg/a.js','dependency')];const p=f.review(entries);
  f.put(f.options.reviewed,gzipSync(JSON.stringify({version:1,classification:3,files:[]})));assert.throws(()=>execute(f.root,p,f.options),/manifest changed/);
  assert.throws(()=>f.review([{path:'../outside',bytes:0,mtimeMs:0,reason:'dependency'}]),/Invalid relative path/);
  const target=f.put('saved/a.js');fs.symlinkSync(path.dirname(target),path.join(f.root,'node_modules/link'),'junction');
  assert.throws(()=>f.review([f.entry('node_modules/link/a.js','dependency')]),/Linked path/);
});
test('a live browser protects its profile even after its launching Node process exited',t=>{
  const f=fixture(t),rel='.runtime/test-tmp/novel-browser-ABC/Default/History';f.put(rel);
  const p=f.review([f.entry(rel,'temp-cache')]);assert.equal(p.candidates.length,1);
  const command='chrome.exe --user-data-dir="'+path.join(f.root,'.runtime/test-tmp/novel-browser-ABC')+'"';
  assert.equal(execute(f.root,p,{...f.options,processes:[{pid:999999,parent:0,name:'chrome.exe',command}]}).deleted.length,0);
});
test('the locked maintenance entry applies the reviewed scope and records skipped audit changes',t=>{
  const f=fixture(t);f.put('node_modules/pkg/a.js');f.put('artifacts/check/final.png');f.put('downloads/book.json','retained');
  const p=f.review([f.entry('node_modules/pkg/a.js','dependency'),f.entry('artifacts/check/final.png','visual')]);
  f.put('artifacts/check/final.png','new result');
  const result=maintain({root:f.root,apply:true,...f.options,expectedReview:p.reviewHash});
  assert.equal(result.deleted.length,1);assert.equal(result.protectedPaths.length,1);
  assert.equal(fs.readFileSync(path.join(f.root,'artifacts/check/final.png'),'utf8'),'new result');
  assert.equal(fs.readFileSync(path.join(f.root,'downloads/book.json'),'utf8'),'retained');
  assert.ok(fs.existsSync(path.join(f.root,'.runtime/storage-maintenance/last-run.json')));
  assert.ok(!fs.existsSync(path.join(f.root,'.runtime/storage-maintenance/maintenance.lock')));
});
test('known bundled app hosts do not block cleanup, while their project task children do',t=>{
  const f=fixture(t);f.put('node_modules/cookies/index.js');const p=f.review([f.entry('node_modules/cookies/index.js','dependency')]);assert.equal(p.candidates.length,1);
  const runtime='C:/Users/test/AppData/Local/OpenAI/Codex/runtimes/cua_node/version/bin/';
  const processes=[{pid:990001,parent:0,name:'codex.exe',command:null},{pid:990002,parent:990001,name:'cmd.exe',command:'cmd.exe /c scripts/launch_codex_app_tools_mcp.cmd'},{pid:990003,parent:990002,name:'node.exe',command:runtime+'node.exe ./server.mjs'},{pid:990004,parent:990001,name:'node.exe',command:runtime+'node.exe '+runtime+'node_modules/@oai/cua-repl/bin/cua-repl.mjs'}];
  assert.equal(plan(f.root,{...f.options,processes}).candidates.length,1);
  assert.equal(plan(f.root,{...f.options,processes:processes.slice(2,3)}).candidates.length,0);
  processes.push({pid:990005,parent:990004,name:'node.exe',command:'node worker.mjs'});
  assert.equal(plan(f.root,{...f.options,processes}).candidates.length,0);
});
