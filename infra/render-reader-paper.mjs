// Run from the repository with: node infra/render-reader-paper.mjs
// Generate once when changing the source; the reader only loads this bitmap.
import sharp from 'sharp';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const source = new URL('./assets/reader-paper.svg', import.meta.url);
const target = new URL('../web-next/public/textures/reader-paper-v2.webp', import.meta.url);
await mkdir(new URL('.', target), {recursive: true});
const {data, info} = await sharp(fileURLToPath(source)).resize(384, 512).ensureAlpha().raw().toBuffer({resolveWithObject: true});
// Only opacity carries the paper grain. A uniform warm pigment removes tiny
// unpremultiplication colour errors and compresses much better. Two alpha
// levels differ by less than one displayed RGB level against the paper base.
for (let index = 0; index < data.length; index += 4) {
  data[index] = 156; data[index + 1] = 135; data[index + 2] = 100;
  data[index + 3] = Math.round(data[index + 3] / 2) * 2;
}
const image = await sharp(data, {raw: {width: info.width, height: info.height, channels: 4}})
  .webp({lossless: true, effort: 6}).toBuffer();
await writeFile(target, image);
console.log(`Reader paper: ${info.width} x ${info.height}, displayed at 768 x 1024, ${image.length} bytes`);
