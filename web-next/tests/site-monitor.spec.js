import {test,expect} from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

let app,child;
const projectRoot=process.cwd(),dir=path.join(projectRoot,'.runtime/task-artifacts/site-monitor-v2');
test.beforeAll(async()=>{fs.mkdirSync(dir,{recursive:true});child=spawn(process.execPath,['--require','./tools/test-env.cjs','tools/site-monitor/tests/browser-fixture.mjs'],{cwd:projectRoot,windowsHide:true,stdio:['pipe','pipe','pipe']});app=await new Promise((resolve,reject)=>{let output='';child.stdout.on('data',b=>{output+=b;if(output.includes('\n')){try{resolve(JSON.parse(output.trim()));}catch(error){reject(error);}}});child.on('error',reject);child.stderr.on('data',b=>reject(Error(String(b))));child.on('exit',code=>{if(code)reject(Error('Fixture failed: '+code));});});});
test.afterAll(async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.stdin.end('close');await exited;}});

test('状态结论、容量条和访客图表可读，桌面及窄窗口无溢出',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);
  await expect(page.getByRole('heading',{name:'网站现在怎么样'})).toBeVisible();await expect(page.getByRole('heading',{name:'已检查的关键项目正常'})).toBeVisible();
  await expect(page.getByRole('meter',{name:'运行内存',exact:true})).toHaveAttribute('aria-valuenow','25');await page.reload();await expect(page.getByRole('meter',{name:'运行内存',exact:true})).toBeVisible();
  await page.screenshot({path:path.join(dir,'final-desktop-overview-fixture.png'),fullPage:true});
  await page.getByRole('button',{name:'访客与内容',exact:true}).click();await expect(page.getByRole('heading',{name:'每天有多少人来'})).toBeVisible();await expect(page.getByRole('img',{name:'每日访客趋势'})).toBeVisible();await expect(page.getByRole('img',{name:'按访问次数划分的设备占比'})).toBeVisible();
  await page.getByText('查看每日数字',{exact:true}).first().click();await expect(page.getByRole('cell',{name:'2026-08-25',exact:true}).first()).toBeVisible();
  await page.waitForTimeout(2200);await expect(page.locator('details[open]')).toHaveCount(1);await page.getByText('查看每日数字',{exact:true}).first().click();
  await page.screenshot({path:path.join(dir,'final-desktop-audience-fixture.png'),fullPage:true});
  await page.getByRole('button',{name:'7 天',exact:true}).click();await expect(page.getByRole('button',{name:'7 天',exact:true})).toHaveAttribute('aria-pressed','true');
  for(const width of [1000,700,390]){await page.setViewportSize({width,height:1000});await expect(page.getByRole('heading',{name:'每天有多少人来'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:path.join(dir,`verified-audience-${width}-fixture.png`),fullPage:true});}
  await page.getByRole('button',{name:'运行概况',exact:true}).click();await page.screenshot({path:path.join(dir,'final-compact-overview-fixture.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('暂停、设置输入、容量盘点、保存和清理继续可用',async({page})=>{
  await page.goto(app.url);await page.getByRole('button',{name:'暂停刷新',exact:true}).click();await expect(page.getByRole('button',{name:'继续刷新',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'容量与服务',exact:true}).click();await page.getByText('需要排查时，展开技术详情').click();await expect(page.getByText('synthetic_test',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'正文与封面',exact:true}).click();await page.getByRole('button',{name:'开始容量盘点'}).click();await expect(page.getByText('本次盘点完成 · 20 个对象')).toHaveCount(2);
  await page.getByRole('button',{name:'连接设置',exact:true}).click();await page.getByLabel('数据库套餐容量上限（MiB）').fill('768');await page.waitForTimeout(2300);await expect(page.getByLabel('数据库套餐容量上限（MiB）')).toHaveValue('768');await page.getByRole('button',{name:'保存服务器设置'}).click();await expect(page.getByText('设置已保存，正在核对连接结果',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'继续刷新',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'报告与清理',exact:true}).click();await page.getByRole('button',{name:'保存本次报告',exact:true}).click();await page.getByRole('button',{name:'保存完整 JSON'}).click();await expect(page.getByRole('button',{name:'下载副本'})).toBeVisible();await page.getByRole('button',{name:'预览过期清理'}).click();await expect(page.getByText('当前没有需要清理的过期文件。')).toBeVisible();await page.getByRole('button',{name:'关闭',exact:true}).last().click();
});

test('高占用标红、未授权不展示假数据、失联旧值明确提示',async({page})=>{
  await page.route('**/api/state',async route=>{const response=await route.fetch(),state=await response.json();state.modules.server.data.memory.available=state.modules.server.data.memory.total*.05;state.modules.analytics.data={status:'unconfigured'};state.modules.realtime.data={status:'unconfigured'};await route.fulfill({response,json:state});});
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'有异常需要处理'})).toBeVisible();await expect(page.getByRole('meter',{name:'运行内存',exact:true})).toHaveClass(/danger/);await page.screenshot({path:path.join(dir,'verified-capacity-warning-fixture.png'),fullPage:true});
  await page.getByRole('button',{name:'访客与内容',exact:true}).click();await expect(page.getByRole('heading',{name:'连接谷歌，看见读者的变化'})).toBeVisible();await expect(page.getByRole('img',{name:'每日访客趋势'})).toHaveCount(0);await expect(page.getByRole('img',{name:'每日新增注册'})).toBeVisible();
  await page.unroute('**/api/state');await page.route('**/api/state',async route=>{const response=await route.fetch(),state=await response.json();state.modules.server.status='error';state.modules.server.error='服务器只读查询失败';state.modules.analytics.status='error';state.modules.analytics.error='谷歌暂时无法连接';await route.fulfill({response,json:state});});await page.waitForTimeout(2400);await expect(page.getByText(/当前保留上次成功结果，不能当作最新数据/).first()).toBeVisible();await page.getByRole('button',{name:'运行概况',exact:true}).click();await expect(page.getByRole('meter',{name:'运行内存',exact:true})).toHaveClass(/unknown/);await expect(page.getByRole('heading',{name:'已检查的关键项目正常'})).toHaveCount(0);
});
