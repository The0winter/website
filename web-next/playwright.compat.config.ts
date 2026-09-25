import {defineConfig} from '@playwright/test';
import base from './playwright.config';

// UA profiles exercise detection only. QQ/UC/Android run on desktop Chromium;
// WebKit is an engine check, not a substitute for an iPhone's native UI.
export default defineConfig({
  ...base,
  timeout:45000,
  testMatch:/browser-compat\.spec\.ts/,
  use:{...base.use,channel:undefined,viewport:{width:390,height:844},hasTouch:true,isMobile:true,actionTimeout:12000},
  projects:[
    {name:'Safari-WebKit',use:{browserName:'webkit'}},
    {name:'Edge',use:{browserName:'chromium',channel:'msedge'}},
    {name:'UC-contract',use:{browserName:'chromium',channel:'chrome',userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 UCBrowser/17.0.0.0 Mobile Safari/537.36'}},
    {name:'QQ-contract',use:{browserName:'chromium',channel:'chrome',userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 MQQBrowser/19.0 Mobile Safari/537.36'}},
    {name:'Android-fallback',use:{browserName:'chromium',channel:'chrome',userAgent:'Mozilla/5.0 (Linux; Android 8.0) AppleWebKit/537.36 Version/4.0 Mobile Safari/537.36'}},
  ],
});
