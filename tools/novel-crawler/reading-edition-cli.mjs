import {parseArgs} from 'node:util';
import {readJson} from './storage.mjs';
import {bindReadingEdition} from './core.mjs';

// Maintenance-only adoption of an already reviewed artifact. Ordinary users
// subsequently use the existing desktop Check updates button.
const {values} = parseArgs({options: {spec: {type: 'string'}, file: {type: 'string'}, 'state-dir': {type: 'string'}, 'output-dir': {type: 'string'}, 'source-order-review': {type: 'string'}}});
if (!values.spec || !values.file) throw Error('用法：node tools/novel-crawler/reading-edition-cli.mjs --spec 原始任务/spec.json --file 已核对的网站阅读版.json [--state-dir 目录] [--output-dir 目录]');
if (values['source-order-review'] && !readJson(values['source-order-review'])) throw Error('来源顺序核对文件不存在或为空');
console.log(JSON.stringify(await bindReadingEdition(readJson(values.spec), values.file, {stateDir: values['state-dir'], outputDir: values['output-dir'], ...(values['source-order-review'] ? {sourceOrderReview: readJson(values['source-order-review'])} : {})}), null, 2));
