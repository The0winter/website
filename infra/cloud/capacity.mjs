import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const disk = fs.statfsSync(root);
const available = disk.bavail * disk.bsize;
console.log(JSON.stringify({sampledAt: new Date().toISOString(), node: process.version,
  platform: process.platform, cpus: os.cpus().length, memoryBytes: os.totalmem(),
  disk: {totalBytes: disk.blocks * disk.bsize, availableBytes: available, reserveBytes: 8 * 1024 ** 3,
    reserveSatisfied: available >= 8 * 1024 ** 3},
  dependencies: Object.fromEntries(['.', 'server', 'web-next', 'tools/novel-crawler'].map(dir => [dir, fs.existsSync(path.join(root, dir, 'node_modules'))]))}, null, 2));
