import path from 'node:path';
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', timeout: 90000, workers: 1, use: { headless: true, channel: 'chrome',viewport:{width:Number(process.env.PLAYWRIGHT_VIEWPORT_WIDTH||1440),height:900} }, reporter: [['list'],['json',{ outputFile: path.resolve('artifacts/playwright-current.json') }]] });
