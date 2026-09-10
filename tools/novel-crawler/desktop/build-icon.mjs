import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer';

const directory = path.dirname(fileURLToPath(import.meta.url));
const svg = fs.readFileSync(path.join(directory, 'icon.svg'), 'utf8');
const executablePath = [process.env.NOVEL_CRAWLER_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', puppeteer.executablePath()].filter(Boolean).find(file => fs.existsSync(file));
if (!executablePath) throw Error('Chrome or Edge is required to render the application icon.');
const browser = await puppeteer.launch({headless: true, executablePath});
try {
  const page = await browser.newPage();
  const sizes = [16, 24, 32, 48, 64, 128, 256], images = [];
  for (const size of sizes) {
    await page.setViewport({width: size, height: size, deviceScaleFactor: 1});
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    images.push(Buffer.from(await page.screenshot({type: 'png', omitBackground: true})));
  }
  // Windows ICO directory with one PNG image for each desktop/DPI size.
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  const output = path.join(directory, 'icon.ico');
  fs.writeFileSync(output, Buffer.concat([header, ...images]));
  console.log(`Created ${output} (${sizes.join(', ')} px)`);
} finally { await browser.close(); }
