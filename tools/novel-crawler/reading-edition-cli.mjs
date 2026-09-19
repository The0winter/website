import {parseArgs} from 'node:util';
import {readJson} from './storage.mjs';
import {bindReadingEdition, reviewReadingNotice, reviewReadingNumbering} from './core.mjs';

// Maintenance-only adoption of an already reviewed artifact. Ordinary users
// subsequently use the existing desktop Check updates button.
const {values} = parseArgs({options: {spec: {type: 'string'}, file: {type: 'string'}, 'state-dir': {type: 'string'}, 'output-dir': {type: 'string'}, 'source-order-review': {type: 'string'}, 'notice-review': {type: 'string'}, 'numbering-review': {type:'string'}}});
if (!values.spec || (!values.file && !values['notice-review'] && !values['numbering-review'])) throw Error('用法：node tools/novel-crawler/reading-edition-cli.mjs --spec 原始任务/spec.json --file 已核对的网站阅读版.json [--state-dir 目录] [--output-dir 目录]；新增条目核对可改用 --notice-review 或 --numbering-review 核对.json');
if (values['source-order-review'] && !readJson(values['source-order-review'])) throw Error('来源顺序核对文件不存在或为空');
const options = {stateDir: values['state-dir'], outputDir: values['output-dir'], ...(values['source-order-review'] ? {sourceOrderReview: readJson(values['source-order-review'])} : {})};
console.log(JSON.stringify(values['numbering-review'] ? await reviewReadingNumbering(readJson(values.spec),readJson(values['numbering-review']),options) : values['notice-review'] ? await reviewReadingNotice(readJson(values.spec), readJson(values['notice-review']), options) : await bindReadingEdition(readJson(values.spec), values.file, options), null, 2));
