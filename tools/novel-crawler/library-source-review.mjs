import fs from 'node:fs';
import path from 'node:path';
import {atomicWrite, readJson, hash} from './storage.mjs';
import {validateSpec, extractionHash, jobId, localBookState} from './core.mjs';
import {continuationKey} from './continuation.mjs';

const reviewFile = (stateDir, book) => path.join(stateDir, 'library-source-reviews', continuationKey(book) + '.json');

// Explicit maintenance review, never automatic fallback to an obsolete adapter.
// Both the accepted per-book rules and today's site template are pinned. A later
// site change, broken binding or modified export still stops normal updates.
export function reviewLibrarySource({stateDir, outputDir, file, spec: input, siteSpec, reason}) {
  stateDir=path.resolve(stateDir); outputDir=path.resolve(outputDir); file=path.resolve(outputDir,file);
  if(path.dirname(file)!==outputDir||fs.lstatSync(file).isSymbolicLink())throw Error('核对文件必须位于下载目录');
  if(typeof reason!=='string'||!reason.trim())throw Error('需要具体的来源规则核对理由');
  const spec=validateSpec(input),book=readJson(file);
  if(spec.title!==book.title||spec.author!==book.author||spec.sourceUrl!==siteSpec.sourceUrl)throw Error('来源规则核对的作品或网站不匹配');
  const key=continuationKey(book),continuation=readJson(path.join(stateDir,'continuations',key,'binding.json'));
  const record=continuation||readJson(path.join(stateDir,'jobs',jobId(spec),'reading-edition.json'));
  if(!record?.value||record.hash!==hash(record.value)||record.value.outputPath!==file||record.value.exportHash!==hash(fs.readFileSync(file)))throw Error('仅可核对有效续更或阅读版绑定，文件及哈希必须匹配');
  const local=localBookState(spec,{stateDir,outputDir});
  if(local.blocked||!['complete','partial'].includes(local.state))throw Error(local.message||'原规则与绑定不匹配');
  const value={version:1,title:book.title,author:book.author,outputPath:file,spec,extraction:extractionHash(spec),siteExtraction:extractionHash(siteSpec),reviewedExportHash:record.value.exportHash,reason,reviewedAt:new Date().toISOString()};
  const target=reviewFile(stateDir,book);atomicWrite(target,{value,hash:hash(value)});
  return {reviewFile:target,title:book.title};
}

export function reviewedLibrarySpec(stateDir, outputDir, book, siteSpec) {
  const record=readJson(reviewFile(stateDir,book));
  if(!record)return null;
  const value=record.value;
  if(!value||record.hash!==hash(value)||value.version!==1||value.outputPath!==path.join(outputDir,book.file)||value.title!==book.title||value.author!==book.author||value.spec.sourceUrl!==siteSpec.sourceUrl||value.extraction!==extractionHash(value.spec))throw Error('已核对的单本来源规则记录损坏或不匹配');
  if(value.siteExtraction!==extractionHash(siteSpec))throw Error('网站规则在单本核对后再次变化，请重新核对；原文件保留');
  return validateSpec(value.spec);
}
