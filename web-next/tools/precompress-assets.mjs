// Build-time compression keeps request handling and browser execution unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import zlib from 'node:zlib';
const compress = promisify(zlib.brotliCompress);

export async function precompressAssets(directory) {
  let files = 0, originalBytes = 0, compressedBytes = 0;
  async function visit(folder) {
    for (const entry of await fs.readdir(folder, {withFileTypes: true})) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /\.(js|css)$/.test(entry.name)) {
        const source = await fs.readFile(file);
        const compressed = await compress(source, {params: {
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        }});
        // Verify every artifact before publishing it alongside the original.
        if (!zlib.brotliDecompressSync(compressed).equals(source)) throw new Error(`Compression verification failed: ${file}`);
        await fs.writeFile(`${file}.br`, compressed);
        files++; originalBytes += source.length; compressedBytes += compressed.length;
      }
    }
  }
  await visit(directory);
  return {files, originalBytes, compressedBytes};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', process.env.NEXT_DIST_DIR || '.next-candidate', 'static');
  precompressAssets(directory).then(result => console.log('Verified static compression:', JSON.stringify(result)))
    .catch(error => {console.error(error); process.exitCode = 1;});
}
