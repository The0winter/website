import {defineConfig} from '@playwright/test';
import base from './playwright.config';

// These are real desktop engines at mobile sizes. They do not emulate a phone's
// OS share sheet; book-share.spec.ts tests the native/QQ contracts with stubs.
export default defineConfig({
  ...base,
  testMatch: /book-share(?:-real|-browsers)?\.spec\.ts/,
  use: {...base.use, channel:undefined},
  projects: [
    {name:'Chrome', use:{browserName:'chromium',channel:'chrome',hasTouch:true}},
    {name:'Edge', use:{browserName:'chromium',channel:'msedge',hasTouch:true}},
    {name:'Firefox', use:{browserName:'firefox',hasTouch:true}},
    {name:'WebKit', use:{browserName:'webkit',hasTouch:true}},
  ],
});
