import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {cleanLocalBook} from '../clean-library.mjs';
import {hash, atomicWrite, readJson} from '../storage.mjs';
import {continuationKey} from '../continuation.mjs';
import {sourceContentHash} from '../../../shared/reading-cleanup.mjs';

test('historical cleanup snapshots and resumes export, reading and continuation states; external edits are rejected', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reading-cleanup-'));
  const stateDir=path.join(root,'.novel-crawler'),outputDir=path.join(root,'downloads'),file='书.json';
  const book={title:'测试',author:'作者',sourceUrl:'https://www.shudugu.org/1/',chapters:[{title:'第1章 测试',chapter_number:1,link:'https://www.shudugu.org/1/2.html',content:'第1章 测试!\n正文中有网址这个词，不删除。\n：',sourceSection:'第一卷 初始'}]};
  const filename=path.join(outputDir,file),key=continuationKey(book),jobDir=path.join(stateDir,'jobs','a'.repeat(20));
  const seal=value=>({hash:hash(value),value});
  atomicWrite(filename,book);const originalHash=hash(fs.readFileSync(filename));
  atomicWrite(path.join(jobDir,'spec.json'),book);
  atomicWrite(path.join(jobDir,'export.json'),{path:filename,hash:originalHash});
  atomicWrite(path.join(jobDir,'reading-edition.json'),seal({book,outputPath:filename,file,exportHash:originalHash,revision:1,sources:[{contentHash:hash(book.chapters[0].content)}]}));
  const bindingFile=path.join(stateDir,'continuations',key,'binding.json');
  atomicWrite(bindingFile,seal({outputPath:filename,file,exportHash:originalHash,revision:1}));
  try {
    const preview=await cleanLocalBook({root,stateDir,outputDir,file});assert.equal(preview.changes.length,1);assert.equal(hash(fs.readFileSync(filename)),originalHash);
    await assert.rejects(cleanLocalBook({root,stateDir,outputDir,file,apply:true,failAfterJournal:true}),/injected/);
    assert.equal(hash(fs.readFileSync(filename)),originalHash);
    await cleanLocalBook({root,stateDir,outputDir,file,apply:true});
    const next=readJson(filename),afterHash=hash(fs.readFileSync(filename));
    assert.equal(next.chapters[0].content,'正文中有网址这个词，不删除。');
    assert.equal(next.chapters[0].volume_number,1);
    assert.equal(sourceContentHash(next.chapters[0]),hash(book.chapters[0].content));
    assert.equal(readJson(path.join(jobDir,'export.json')).hash,afterHash);
    assert.equal(readJson(path.join(jobDir,'reading-edition.json')).value.exportHash,afterHash);
    assert.equal(readJson(bindingFile).value.exportHash,afterHash);
    assert.equal((await cleanLocalBook({root,stateDir,outputDir,file,apply:true})).changes.length,0);
    const tampered={...next,chapters:[{...next.chapters[0],content:'未授权改变'}]};atomicWrite(filename,tampered);
    await assert.rejects(cleanLocalBook({root,stateDir,outputDir,file,apply:true}),/不一致/);
  } finally {
    const resolved=fs.realpathSync(root),tempRoot=fs.realpathSync(os.tmpdir());
    if(!resolved.startsWith(tempRoot+path.sep))throw Error('Unsafe fixture cleanup');
    fs.rmSync(resolved,{recursive:true});
  }
});
