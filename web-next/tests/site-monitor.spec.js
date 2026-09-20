import {test,expect} from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

let app,child;
const projectRoot=process.cwd();
test.beforeAll(async()=>{child=spawn(process.execPath,['--require','./tools/test-env.cjs','tools/site-monitor/tests/browser-fixture.mjs'],{cwd:projectRoot,windowsHide:true,stdio:['pipe','pipe','pipe']});app=await new Promise((resolve,reject)=>{let output='';child.stdout.on('data',b=>{output+=b;if(output.includes('\n')){try{resolve(JSON.parse(output.trim()));}catch(error){reject(error);}}});child.on('error',reject);child.stderr.on('data',b=>reject(Error(String(b))));child.on('exit',code=>{if(code)reject(Error('Fixture failed: '+code));});});});
test.afterAll(async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.stdin.end('close');await exited;}});
test('本地监控界面：刷新、设置、只读盘点、导出与清理',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);
  await expect(page.getByRole('heading',{name:'网站运行总览'})).toBeVisible();await expect(page.getByText('3 GiB',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'暂停刷新',exact:true}).click();await expect(page.getByRole('button',{name:'继续刷新',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'刷新全部',exact:true}).click();
  await page.getByRole('button',{name:'Atlas 数据库',exact:true}).click();await expect(page.getByText('synthetic_test',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'R2 存储',exact:true}).click();await page.getByRole('button',{name:'开始容量盘点'}).click();await expect(page.getByText('盘点完成 · 20 个对象 · 1 次列表请求')).toHaveCount(2);
  await page.getByRole('button',{name:'连接设置',exact:true}).click();await page.getByLabel('Atlas 套餐容量上限（MiB）').fill('512');await page.waitForTimeout(2300);await expect(page.getByLabel('Atlas 套餐容量上限（MiB）')).toHaveValue('512');
  await page.getByRole('button',{name:'报告与清理',exact:true}).click();await page.getByRole('button',{name:'保存本次报告',exact:true}).click();await page.getByRole('button',{name:'保存完整 JSON'}).click();await expect(page.getByRole('button',{name:'下载副本'})).toBeVisible();
  await page.getByRole('button',{name:'预览过期清理'}).click();await expect(page.getByText('当前没有需要清理的过期文件。')).toBeVisible();await page.getByRole('button',{name:'关闭',exact:true}).last().click();
  await page.getByRole('button',{name:'总览',exact:true}).click();const dir=path.join(projectRoot,'.runtime/task-artifacts/site-monitor');fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,'final-desktop-fixture.png'),fullPage:true});
  await page.setViewportSize({width:700,height:1000});await page.screenshot({path:path.join(dir,'final-compact-fixture.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
