import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {gzipSync, gunzipSync} from 'node:zlib';
import {atomicWrite, readJson, hash, withLock} from './storage.mjs';
import {continuationKey} from './continuation.mjs';
import {checkIdentity} from './quality.mjs';
import {normalizeBookCategory} from './categories.mjs';

const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const seal = value => ({value, hash: hash(value)});
function unseal(record) { assert.equal(record.hash, hash(record.value), '来源绑定记录损坏'); return record.value; }
const withoutCategory = book => Object.fromEntries(Object.entries(book).filter(([key]) => !['category','categoryEvidence','categoryDetection'].includes(key)));

// Holds the same book/job locks as acquisition. The journal can finish either
// write order after a crash, but refuses a third, externally edited version.
export async function updateLocalBookCategory({record, plan, stateDir, outputDir, backupDir}) {
  stateDir = path.resolve(stateDir); outputDir = path.resolve(outputDir); backupDir = path.resolve(backupDir);
  const file = path.resolve(outputDir, plan.file), key = continuationKey(plan);
  assert.equal(path.dirname(file), outputDir, '书籍文件必须位于下载目录');
  assert.ok(normalizeBookCategory(record.category) && record.categoryEvidence?.url && record.categoryEvidence?.checkedAt);
  checkIdentity(plan, record);
  assert.equal(plan.sourceUrl, record.sourceUrl);
  return withLock(path.join(stateDir, 'book-locks', key + '.lock'), async () => {
    const jobs = fs.readdirSync(path.join(stateDir, 'jobs'), {withFileTypes:true}).filter(e=>e.isDirectory() && /^[a-f0-9]{20}$/.test(e.name)).map(e=>path.join(stateDir,'jobs',e.name));
    const related = jobs.filter(dir => {
      const raw = readJson(path.join(dir,'export.json'));
      if (raw?.path === file) return true;
      // Reading-edition records contain a whole novel. Filter their small
      // identity records first instead of parsing every novel for every book.
      const spec = readJson(path.join(dir,'spec.json'));
      if (!spec) return false;
      try { checkIdentity(plan.spec || plan,spec); } catch { return false; }
      return readJson(path.join(dir,'reading-edition.json'))?.value?.outputPath === file;
    });
    const locked = async index => index < related.length ? withLock(path.join(related[index],'job.lock'),()=>locked(index+1)) : update();
    const update = () => {
      const root = path.join(backupDir, key), journalFile = path.join(root,'journal.json');
      let journal = readJson(journalFile);
      if (journal) { assert.equal(journal.title,record.title); assert.equal(journal.category,record.category,'已有不同分类的补全记录，需要新的备份目录'); }
      if (journal?.done) {
        for(const op of journal.operations) assert.equal(hash(fs.readFileSync(op.target)),op.afterHash,'上次补全后文件发生变化，需重新核对');
        return {title:record.title,category:record.category,reused:true,unchangedContent:true};
      }
      if (!journal) {
        assert.ok(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(),'下载文件必须是普通文件');
        const raw = fs.readFileSync(file), book = JSON.parse(raw);
        assert.equal(hash(raw),plan.hash,'排队期间下载文件发生变化');
        checkIdentity(record,book); assert.equal(book.sourceUrl,record.sourceUrl);
        const nextBook = {...book,category:record.category,categoryDetection:'verified',categoryEvidence:record.categoryEvidence};
        assert.equal(hash(withoutCategory(nextBook)),hash(withoutCategory(book)));
        const nextHash = hash(bytes(nextBook)), updates = new Map([[file,bytes(nextBook)]]);
        const continuationDir = path.join(stateDir,'continuations',key), bindingFile = path.join(continuationDir,'binding.json');
        let continuationOwnsFile = false;
        assert.ok(!fs.existsSync(path.join(continuationDir,'pending.json')),'需先恢复尚未完成的续更');
        if (fs.existsSync(bindingFile)) {
          const binding = unseal(readJson(bindingFile));
          assert.equal(binding.outputPath,file); assert.equal(binding.exportHash,hash(raw));
          continuationOwnsFile = true;
          updates.set(bindingFile,bytes(seal({...binding,revision:(binding.revision||0)+1,exportHash:nextHash})));
        }
        for(const dir of related) {
          assert.ok(!fs.existsSync(path.join(dir,'reading-edition-pending.json')),'需先恢复尚未完成的阅读版更新');
          const exportFile = path.join(dir,'export.json'), exported = readJson(exportFile);
          const readingFile = path.join(dir,'reading-edition.json'), reading = readJson(readingFile);
          // A continuation may supersede an older raw/reading checkpoint that
          // still names this file. Keep that dormant archive intact; only the
          // verified active binding authorizes updating today's accepted file.
          if (continuationOwnsFile && ((exported?.path===file && exported.hash!==hash(raw)) || (reading?.value?.outputPath===file && reading.value.exportHash!==hash(raw)))) continue;
          if(exported?.path===file){assert.equal(exported.hash,hash(raw));updates.set(exportFile,bytes({...exported,hash:nextHash}));}
          if(reading?.value?.outputPath===file){
            const value=unseal(reading);assert.equal(value.exportHash,hash(raw));
            updates.set(readingFile,bytes(seal({...value,revision:(value.revision||0)+1,exportHash:nextHash,book:nextBook})));
          }
          const specFile=path.join(dir,'spec.json'),spec=readJson(specFile);
          if(spec)updates.set(specFile,bytes({...spec,category:record.category,categoryDetection:'verified',categoryEvidence:record.categoryEvidence}));
        }
        fs.mkdirSync(root,{recursive:true});
        const operations=[];
        for(const [target,after] of updates){
          const before=fs.readFileSync(target),index=operations.length;
          fs.writeFileSync(path.join(root,`${index}-before.gz`),gzipSync(before));
          fs.writeFileSync(path.join(root,`${index}-after.gz`),gzipSync(after));
          operations.push({target,beforeHash:hash(before),afterHash:hash(after),index});
        }
        journal={title:record.title,category:record.category,operations,contentHash:hash(withoutCategory(book)),chapters:book.chapters.length};
        atomicWrite(journalFile,journal);
      }
      for(const op of journal.operations)assert.ok([op.beforeHash,op.afterHash].includes(hash(fs.readFileSync(op.target))),'补全过程中文件被修改，已保留修改');
      for(const op of journal.operations){
        if(hash(fs.readFileSync(op.target))===op.afterHash)continue;
        const after=gunzipSync(fs.readFileSync(path.join(root,`${op.index}-after.gz`)));assert.equal(hash(after),op.afterHash);
        atomicWrite(op.target,after);
      }
      assert.equal(hash(withoutCategory(readJson(file))),journal.contentHash,'非分类内容发生变化');
      for(const op of journal.operations)assert.equal(hash(fs.readFileSync(op.target)),op.afterHash);
      atomicWrite(journalFile,{...journal,done:true,finishedAt:new Date().toISOString()});
      // Regenerable after-images are removed; compressed before-images remain
      // as the recovery backup. Every removal is one explicit file in this job.
      for(const op of journal.operations)fs.unlinkSync(path.join(root,`${op.index}-after.gz`));
      return {title:record.title,category:record.category,chapters:journal.chapters,unchangedContent:true,checkpoints:journal.operations.length-1};
    };
    return locked(0);
  });
}
