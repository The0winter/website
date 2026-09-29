import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {connectDatabase} from '../database/index.js';
import {readConfig} from '../config.js';
import Reply from '../models/ForumReply.js';
import {importForumArticles} from '../services/forum-import.js';

const args = process.argv.slice(2), file = args.find(arg => !arg.startsWith('--'));
const value = key => args.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
try {
  if (!file || args.filter(arg => !arg.startsWith('--')).length !== 1 || args.some(arg => arg.startsWith('--') && arg !== '--apply' && !/^--(admin|target|audit)=.+/.test(arg))) throw new Error('Usage: forum-articles.js FILE [--admin=NAME] [--apply --target=DATABASE_FINGERPRINT --audit=FILE]');
  const config = readConfig(), apply = args.includes('--apply');
  const target = crypto.createHash('sha256').update(config.uri).digest('hex');
  if (apply && (config.writeMode !== 'readwrite' || value('target') !== target || !value('audit'))) throw new Error('导入需要可写数据库、匹配预览的 target 及新的 audit 文件路径');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  await connectDatabase(config.uri, {monitorCommands:false});
  const preview = await importForumArticles(manifest, {admin:value('admin')});
  if (!apply) console.log(JSON.stringify({...preview, target}));
  else {
    const audit = {preparedAt:new Date().toISOString(), target, preview, manifestSha256:crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex')};
    await fs.writeFile(value('audit'), JSON.stringify(audit, null, 2), {flag:'wx', mode:0o600});
    await Reply.createIndexes();
    const result = await importForumArticles(manifest, {apply:true, admin:value('admin')});
    const verified = await importForumArticles(manifest, {admin:value('admin')});
    if (Object.values(verified.created).some(Boolean)) throw new Error('导入回读未通过');
    await fs.writeFile(value('audit'), JSON.stringify({...audit, result, verifiedAt:new Date().toISOString()}, null, 2), {mode:0o600});
    console.log(JSON.stringify(result));
  }
} catch (error) {
  // Driver diagnostics can contain connection details; keep those off stdout.
  console.error(error.name === 'Error' ? error.message : `书评导入失败：${error.name}`);
  process.exitCode = 1;
} finally {await mongoose.disconnect();}
