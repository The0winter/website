#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {validateSpec, extractionHash, defaultStateDir} from './core.mjs';
import {continuationKey, recordContinuationReview, recordContinuationAnchorReview, recordContinuationNoticeReview, recordContinuationPartPolicy, bindReviewedCompletedSource, recordContinuationNumberReset, recordContinuationNumberCorrection, recordContinuationSourceDefect} from './continuation.mjs';
import {withLock} from './storage.mjs';

try {
  const {values} = parseArgs({options: {...Object.fromEntries(['spec', 'state-dir', 'output-dir', 'first', 'second', 'keep', 'reason', 'anchor-file', 'old-number', 'new-link', 'old-hash', 'new-hash', 'notice-link', 'chapter-parts', 'completed-source', 'number-reset', 'number-correction', 'source-defect'].map(name => [name, {type: 'string'}])),
    'part-link': {type: 'string', multiple: true}, 'part-hash': {type: 'string', multiple: true}, 'part-family': {type: 'string', multiple: true}}});
  if (!values.spec) throw Error('需要 --spec 来源.json --first 链接 --second 链接 --keep 保留链接 --reason 核对理由');
  const spec = validateSpec(JSON.parse(fs.readFileSync(values.spec, 'utf8'))), stateDir = path.resolve(values['state-dir'] || defaultStateDir);
  if (values['chapter-parts'] && values['chapter-parts'] !== 'paired') throw Error('--chapter-parts 仅支持 paired');
  if (values['part-family'] && !values['chapter-parts']) throw Error('--part-family 必须与 --chapter-parts paired 一起使用');
  if (values['part-link'] && values['new-link'] || values['part-hash'] && values['new-hash']) throw Error('单章与拆章参数不能混用');
  const result = await withLock(path.join(stateDir, 'book-locks', continuationKey(spec) + '.lock'), () => values['source-defect']
    ? recordContinuationSourceDefect(spec, {stateDir, extraction: extractionHash(spec)}, JSON.parse(fs.readFileSync(values['source-defect'], 'utf8')))
    : values['number-correction']
    ? recordContinuationNumberCorrection(spec, {stateDir, extraction: extractionHash(spec)}, JSON.parse(fs.readFileSync(values['number-correction'], 'utf8')))
    : values['number-reset']
    ? recordContinuationNumberReset(spec, {stateDir, extraction: extractionHash(spec)}, JSON.parse(fs.readFileSync(values['number-reset'], 'utf8')))
    : values['completed-source']
    ? bindReviewedCompletedSource(spec, {stateDir, extraction: extractionHash(spec), outputDir: path.resolve(values['output-dir'] || 'downloads')}, JSON.parse(fs.readFileSync(values['completed-source'], 'utf8')))
    : values['chapter-parts']
    ? recordContinuationPartPolicy(spec, {stateDir, extraction: extractionHash(spec)}, {reason: values.reason, families: values['part-family']})
    : values['notice-link']
    ? recordContinuationNoticeReview(spec, {stateDir, extraction: extractionHash(spec)}, {link: values['notice-link'], contentHash: values['new-hash'], reason: values.reason})
    : values['anchor-file']
    ? recordContinuationAnchorReview(spec, {stateDir, extraction: extractionHash(spec), outputDir: path.resolve(values['output-dir'] || 'downloads')},
      {file: values['anchor-file'], oldNumber: Number(values['old-number']), newLink: values['new-link'], newLinks: values['part-link'], oldHash: values['old-hash'], newHash: values['new-hash'], newHashes: values['part-hash'], reason: values.reason})
    : recordContinuationReview(spec, {stateDir, extraction: extractionHash(spec)},
      {firstLink: values.first, secondLink: values.second, keepLink: values.keep, reason: values.reason}));
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(JSON.stringify({error: error.message})); process.exitCode = 1; }
