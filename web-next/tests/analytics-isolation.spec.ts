import {test,expect} from '@playwright/test';
import {blockAnalytics} from './fixtures/without-analytics';

test('浏览器验收屏蔽 GA 脚本和上报，保留网站请求并覆盖同一上下文的新页面',async({context,page})=>{
  const forwarded:string[]=[];
  // Mock every network destination first, so this verification cannot emit real traffic.
  await context.route('**/*',async route=>{forwarded.push(route.request().url());await route.fulfill({contentType:'text/html',body:'<!doctype html><title>Analytics isolation</title>'});});
  await blockAnalytics(context);
  await page.goto('https://monitor.test/');
  const urls=['https://www.googletagmanager.com/gtag/js?id=G-SYNTHETIC','https://region1.google-analytics.com/g/collect','https://www.google-analytics.com/collect','https://analytics.google.com/g/collect','https://stats.g.doubleclick.net/g/collect'];
  const result=await page.evaluate(async urls=>Promise.all(urls.map(async url=>{try{await fetch(url,{mode:'no-cors'});return 'sent';}catch{return 'blocked';}})),urls);
  expect(result).toEqual(urls.map(()=>'blocked'));await page.evaluate(()=>fetch('/api/health'));
  const other=await context.newPage();await other.goto('https://monitor.test/second');
  expect(await other.evaluate(async()=>{try{await fetch('https://www.google-analytics.com/g/collect',{mode:'no-cors'});return false;}catch{return true;}})).toBe(true);
  expect(forwarded).toEqual(['https://monitor.test/','https://monitor.test/api/health','https://monitor.test/second']);
});
