require('../test-env.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const {testTempDir} = require('../test-env.cjs');

test('compression preserves exact JS/CSS bytes, ignores other assets and refreshes rebuilt content', async () => {
  const {precompressAssets} = await import('../../web-next/tools/precompress-assets.mjs');
  const folder = await fs.mkdtemp(path.join(testTempDir, 'static-compression-'));
  try {
    await fs.mkdir(path.join(folder, 'nested'));
    const originals = {'app.js': 'const title="书籍详情 📖";\n'.repeat(100), 'nested/style.css': '.目录::before{content:"章节"}\n'.repeat(100), 'image.png': 'untouched'};
    for (const [name, value] of Object.entries(originals)) await fs.writeFile(path.join(folder, name), value);
    assert.equal((await precompressAssets(folder)).files, 2);
    for (const [name, value] of Object.entries(originals)) {
      const source = await fs.readFile(path.join(folder, name));
      assert.deepEqual(source, Buffer.from(value));
      if (name.endsWith('.png')) await assert.rejects(fs.stat(path.join(folder, name + '.br')), {code: 'ENOENT'});
      else assert.deepEqual(zlib.brotliDecompressSync(await fs.readFile(path.join(folder, name + '.br'))), source);
    }
    await fs.writeFile(path.join(folder, 'app.js'), 'const updated = true;');
    await precompressAssets(folder);
    assert.equal(zlib.brotliDecompressSync(await fs.readFile(path.join(folder, 'app.js.br'))).toString(), 'const updated = true;');
  } finally {
    const target = await fs.realpath(folder), root = await fs.realpath(testTempDir);
    assert.ok(path.relative(root, target).startsWith('static-compression-'));
    await fs.rm(target, {recursive: true});
  }
});
