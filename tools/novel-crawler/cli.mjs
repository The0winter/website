#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {acquire, sourcePlan, defaultStateDir} from './core.mjs';
import {readJson} from './storage.mjs';
import {prepareImport} from '../../infra/import-plan.mjs';

const help = `小说采集（Node 22；EPUB 另需 Python 3）
  node tools/novel-crawler/cli.mjs sources --title "书名" --author "作者"
  node tools/novel-crawler/cli.mjs probe --spec 来源.json [--samples 9]
  node tools/novel-crawler/cli.mjs download --spec 来源.json [--max-new 50]
  node tools/novel-crawler/cli.mjs report --job 任务ID [--mode download]
  node tools/novel-crawler/cli.mjs validate --file downloads/文件.json
可选：--state-dir 路径，--output-dir 路径，--refresh（重取缓存及章节）。
新站需先编写声明式 JSON 提取规则，参阅 docs/智能找书与采集.md。
正文和原始页面只写本地；终端输出统计，不输出章节正文。`;

try {
  const {positionals, values} = parseArgs({allowPositionals: true, options: {
    help: {type: 'boolean'}, spec: {type: 'string'}, title: {type: 'string'}, author: {type: 'string'},
    'state-dir': {type: 'string'}, 'output-dir': {type: 'string'}, samples: {type: 'string'},
    'max-new': {type: 'string'}, refresh: {type: 'boolean'}, job: {type: 'string'}, mode: {type: 'string'}, file: {type: 'string'},
  }});
  const command = positionals[0];
  if (values.help || !command) { console.log(help); }
  else {
    if (positionals.length !== 1) throw Error('每次只运行一个命令');
    const stateDir = path.resolve(values['state-dir'] || defaultStateDir);
    const integer = (name, min, max) => {
      if (values[name] === undefined) return undefined;
      const n = Number(values[name]);
      if (!Number.isInteger(n) || n < min || n > max) throw Error(`${name} 必须为 ${min}～${max} 的整数`);
      return n;
    };
    if (command === 'sources') {
      if (!values.title) throw Error('需要 --title');
      console.log(JSON.stringify(sourcePlan(values.title, values.author, stateDir), null, 2));
    } else if (command === 'probe' || command === 'download') {
      if (!values.spec) throw Error('需要 --spec 来源配置.json');
      if (command === 'probe' && values['max-new'] !== undefined) throw Error('--max-new 仅用于分批下载，试采必须完成选中的样本');
      const result = await acquire(JSON.parse(fs.readFileSync(values.spec, 'utf8')), {mode: command, stateDir, outputDir: values['output-dir'], samples: integer('samples', 4, 30), maxNew: integer('max-new', 1, 20000), refresh: values.refresh, onProgress: data => console.error(JSON.stringify(data))});
      const {issues, missing, ...summary} = result;
      console.log(JSON.stringify({...summary, issueCounts: Object.fromEntries([...new Set(issues.map(i => i.code))].map(code => [code, issues.filter(i => i.code === code).length])), missingCount: missing.length}, null, 2));
      if (!result.structuralPass || (command === 'download' && !result.completeAgainstSource)) process.exitCode = 2;
    } else if (command === 'report') {
      if (!/^[a-f0-9]{20}$/.test(values.job || '') || !['probe', 'download'].includes(values.mode || 'download')) throw Error('需要有效 --job 和 --mode');
      const report = readJson(path.join(stateDir, 'jobs', values.job, `${values.mode || 'download'}-report.json`));
      if (!report) throw Error('报告不存在');
      const {missing, issues, ...summary} = report;
      console.log(JSON.stringify({...summary, missingCount: missing.length, issues: issues.slice(0, 30)}, null, 2));
    } else if (command === 'validate') {
      if (!values.file) throw Error('需要 --file');
      const book = readJson(values.file);
      const batches = prepareImport(book);
      console.log(JSON.stringify({valid: true, title: book.title, chapters: book.chapters.length, batches: batches.length}, null, 2));
    } else throw Error(`未知命令：${command}`);
  }
} catch (error) {
  console.error(JSON.stringify({error: error.message}));
  process.exitCode = 1;
}
