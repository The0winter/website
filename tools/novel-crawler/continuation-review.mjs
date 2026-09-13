#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {validateSpec, extractionHash, defaultStateDir} from './core.mjs';
import {continuationKey, recordContinuationReview} from './continuation.mjs';
import {withLock} from './storage.mjs';

try {
  const {values} = parseArgs({options: Object.fromEntries(['spec', 'state-dir', 'first', 'second', 'keep', 'reason'].map(name => [name, {type: 'string'}]))});
  if (!values.spec) throw Error('需要 --spec 来源.json --first 链接 --second 链接 --keep 保留链接 --reason 核对理由');
  const spec = validateSpec(JSON.parse(fs.readFileSync(values.spec, 'utf8'))), stateDir = path.resolve(values['state-dir'] || defaultStateDir);
  const result = await withLock(path.join(stateDir, 'book-locks', continuationKey(spec) + '.lock'), () => recordContinuationReview(spec, {stateDir, extraction: extractionHash(spec)},
    {firstLink: values.first, secondLink: values.second, keepLink: values.keep, reason: values.reason}));
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(JSON.stringify({error: error.message})); process.exitCode = 1; }
