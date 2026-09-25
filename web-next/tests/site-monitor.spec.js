import {test,expect} from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

let app,child;
const projectRoot=process.cwd(),dir=path.join(projectRoot,'.runtime/task-artifacts/site-monitor-v5');
test.beforeAll(async()=>{fs.mkdirSync(dir,{recursive:true});child=spawn(process.execPath,['--require','./tools/test-env.cjs','tools/site-monitor/tests/browser-fixture.mjs'],{cwd:projectRoot,windowsHide:true,stdio:['pipe','pipe','pipe']});app=await new Promise((resolve,reject)=>{let output='';child.stdout.on('data',b=>{output+=b;if(output.includes('\n')){try{resolve(JSON.parse(output.trim()));}catch(error){reject(error);}}});child.on('error',reject);child.stderr.on('data',b=>reject(Error(String(b))));child.on('exit',code=>{if(code)reject(Error('Fixture failed: '+code));});});});
test.afterAll(async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.stdin.end('close');await exited;}});

test('用户数据优先、正常状态收到底部、容量紧凑，日周月及缩放读数可用',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);
  await expect(page.getByRole('heading',{name:'运行概况',exact:true})).toBeVisible();
  await expect(page.locator('.topbar,.eyebrow,#page-description,#pause,#refresh,.trend-hint')).toHaveCount(0);
  await expect(page.getByText('今天活跃',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('article',{name:'日活',exact:true}).locator('.circle-value')).toHaveText('21');
  await expect(page.getByRole('article',{name:'日活',exact:true}).locator('.circle-new')).toHaveText('新用户 9');
  const lastRead=await page.locator('#last-read').innerText();await page.waitForTimeout(2200);await expect(page.locator('#last-read')).toHaveText(lastRead);
  const daily=await page.locator('.daily-circle').boundingBox(),weekly=await page.getByRole('article',{name:'周活',exact:true}).boundingBox(),monthly=await page.getByRole('article',{name:'月活',exact:true}).boundingBox();
  expect(Math.abs(daily.width-daily.height)).toBeLessThan(1);expect(daily.width).toBeGreaterThan(weekly.width);expect(weekly.y).toBeGreaterThan(daily.y+daily.height);expect(monthly.x).toBeGreaterThan(weekly.x);expect(Math.abs(monthly.y-weekly.y)).toBeLessThan(1);
  expect(await page.locator('.activity-layout').evaluate(e=>e.getBoundingClientRect().top)).toBeLessThan(100);
  const status=page.getByRole('region',{name:'网站状态'}),trend=page.locator('#user-trend');
  await expect(status.getByRole('heading',{name:'已检查的关键项目正常'})).toBeVisible();
  expect(await status.evaluate(e=>e===e.parentElement.lastElementChild)).toBe(true);
  await expect(page.getByRole('article',{name:'日活',exact:true})).toBeVisible();await expect(page.getByRole('article',{name:'周活',exact:true})).toBeVisible();await expect(page.getByRole('article',{name:'月活',exact:true})).toBeVisible();
  await expect(page.getByRole('article',{name:'周活',exact:true}).locator('.circle-value')).toContainText('91');
  await expect(page.getByRole('meter',{name:'运行内存',exact:true})).toHaveAttribute('aria-valuenow','25');
  expect(await page.locator('.compact-resource').first().evaluate(e=>e.getBoundingClientRect().height)).toBeLessThan(95);
  expect(await status.evaluate(e=>e.getBoundingClientRect().height)).toBeLessThan(90);
  await expect(trend).toHaveAttribute('data-total-points','14');
  const svg=trend.getByRole('img',{name:'用户变化趋势'}),box=await svg.boundingBox();await page.mouse.move(box.x+box.width*.6,box.y+120);
  await expect(trend.getByRole('status')).toBeVisible();await expect(trend.getByRole('status')).toContainText('活跃用户');await expect(trend.getByRole('status')).toContainText('新增访客');
  await page.mouse.wheel(0,-240);await expect(trend).toHaveAttribute('data-visible-points','11');await expect(page.getByLabel('移动时间窗口')).toBeVisible();
  await page.getByLabel('移动时间窗口').fill('0');await expect(trend.locator('.trend-range')).toContainText('2026-09-10');
  await trend.getByText('查看趋势数字',{exact:true}).click();await expect(trend.locator('details')).toHaveAttribute('open','');
  await page.evaluate(()=>fetch('/api/refresh',{method:'POST',headers:{'x-monitor-token':sessionStorage.getItem('monitor-token'),'Content-Type':'application/json'},body:JSON.stringify({module:'analytics'})}));await page.waitForTimeout(2200);await expect(trend).toHaveAttribute('data-visible-points','11');
  await expect(trend.locator('details')).toHaveAttribute('open','');await trend.getByText('查看趋势数字',{exact:true}).click();
  await trend.getByRole('img').focus();await page.keyboard.press('End');await expect(trend.getByRole('status')).toContainText('2026-09');
  await page.getByRole('button',{name:'显示全部',exact:true}).click();await expect(trend).toHaveAttribute('data-visible-points','14');
  await page.getByRole('button',{name:'周',exact:true}).click();await expect(trend).toHaveAttribute('data-total-points','8');
  await trend.getByRole('img').focus();await page.keyboard.press('End');await expect(trend.getByRole('status')).toContainText('2026-09-14 至 2026-09-20');
  await page.getByRole('button',{name:'月',exact:true}).click();await expect(trend).toHaveAttribute('data-total-points','6');
  await trend.getByRole('img').focus();await page.keyboard.press('End');await expect(trend.getByRole('status')).toContainText('2026-08');
  await page.getByLabel('用户数据类型').selectOption('registrations');await expect(trend).toHaveAttribute('data-total-points','6');await trend.getByRole('img').focus();await page.keyboard.press('End');await expect(trend.getByRole('status')).toContainText('新增注册');
  await page.getByLabel('用户数据类型').selectOption('visitors');await page.getByRole('button',{name:'日',exact:true}).click();
  const allEnd=await trend.locator('tbody tr').last().textContent();
  await page.getByRole('button',{name:'中国',exact:true}).click();await expect(page.getByRole('article',{name:'日活',exact:true}).locator('.circle-value')).toHaveText('12');
  await expect(page.getByRole('article',{name:'周活',exact:true}).locator('.circle-value')).toHaveText('54');
  expect(await trend.locator('tbody tr').last().textContent()).not.toEqual(allEnd);
  await page.getByRole('button',{name:'其他国家',exact:true}).click();await expect(page.getByRole('article',{name:'日活',exact:true}).locator('.circle-value')).toHaveText('6');
  await page.getByRole('button',{name:'全部',exact:true}).click();await expect(page.getByRole('article',{name:'日活',exact:true}).locator('.circle-value')).toHaveText('21');
  const left=await page.locator('.activity-metrics').boundingBox(),right=await page.locator('.panel:has(#user-trend)').boundingBox();expect(left.x+left.width).toBeLessThan(right.x);expect(Math.abs(left.y-right.y)).toBeLessThan(2);expect(left.width).toBeGreaterThan(230);expect(right.height).toBeLessThan(430);await page.mouse.move(0,0);await page.screenshot({path:path.join(dir,'final-desktop-overview-fixture.png'),fullPage:true});
  for(const width of [1000,700,390,320]){await page.setViewportSize({width,height:1000});await expect(page.getByRole('article',{name:'日活',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:path.join(dir,`verified-overview-${width}-fixture.png`),fullPage:true});}
  await page.getByText('自动化访问观察',{exact:true}).click();await expect(page.getByText('今天原始用户')).toBeVisible();await page.getByRole('button',{name:'看建议过滤',exact:true}).click();await expect(page.getByLabel('用户数据类型')).toHaveValue('retained');await expect(trend.locator('.legend')).toContainText('建议保留用户');await page.getByRole('button',{name:'访客与内容',exact:true}).click();await expect(page.getByRole('heading',{name:'他们从哪里来'})).toBeVisible();await expect(page.getByRole('img',{name:'按访问次数划分的设备占比'})).toBeVisible();
  await page.getByRole('button',{name:'7 天',exact:true}).click();await expect(page.getByRole('button',{name:'7 天',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByText('查看每日数字',{exact:true}).click();await page.waitForTimeout(2200);await expect(page.locator('details[open]')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('地区失败不混入全站人数，缺少地区数据的数据源禁用筛选',async({page})=>{
  await page.route('**/api/state',async route=>{const response=await route.fetch(),state=await response.json();state.modules.analytics.data.regions.china={status:'error',error:'地区查询暂不可用'};state.modules.analytics.lastSuccess=Date.parse('2026-09-25T01:02:03Z');await route.fulfill({response,json:state});});
  await page.goto(app.url);await page.getByRole('button',{name:'中国',exact:true}).click();
  await expect(page.getByText(/中国：地区查询暂不可用/)).toBeVisible();await expect(page.getByRole('article',{name:'日活',exact:true}).locator('.circle-value')).toHaveText('—');await expect(page.locator('#last-read')).toContainText('尚未取得');await expect(page.getByRole('img',{name:'用户变化趋势'})).toHaveCount(0);
  await page.getByLabel('用户数据类型').selectOption('raw');await expect(page.getByRole('button',{name:'中国',exact:true})).toBeDisabled();await expect(page.getByText('此图表数据未记录国家，暂不支持地区筛选。')).toBeVisible();await expect(page.getByRole('article',{name:'日活',exact:true}).locator('.circle-value')).toHaveText('4');
  await page.getByLabel('用户数据类型').selectOption('visitors');await expect(page.getByRole('button',{name:'全部',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('article',{name:'日活',exact:true}).locator('.circle-value')).toHaveText('21');
});

test('设置输入、容量盘点、保存和清理继续可用',async({page})=>{
  await page.goto(app.url);
  await page.getByRole('button',{name:'容量与服务',exact:true}).click();await page.getByText('需要排查时，展开技术详情').click();await expect(page.getByText('synthetic_test',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'正文与封面',exact:true}).click();await page.getByRole('button',{name:'开始容量盘点'}).click();await expect(page.getByText('本次盘点完成 · 20 个对象')).toHaveCount(2);
  await page.getByRole('button',{name:'连接设置',exact:true}).click();await page.getByLabel('数据库套餐容量上限（MiB）').fill('768');await page.waitForTimeout(2300);await expect(page.getByLabel('数据库套餐容量上限（MiB）')).toHaveValue('768');await page.getByRole('button',{name:'保存服务器设置'}).click();await expect(page.getByText('设置已保存，正在核对连接结果',{exact:true})).toBeVisible();await expect(page.locator('#last-read')).toContainText('上次读取时间');
  await page.getByRole('button',{name:'报告与清理',exact:true}).click();await page.getByRole('button',{name:'保存本次报告',exact:true}).click();await page.getByRole('button',{name:'保存完整 JSON'}).click();await expect(page.getByRole('button',{name:'下载副本'})).toBeVisible();await page.getByRole('button',{name:'预览过期清理'}).click();await expect(page.getByText('当前没有需要清理的过期文件。')).toBeVisible();await page.getByRole('button',{name:'关闭',exact:true}).last().click();
});

test('异常自动置顶，未授权或旧数据不冒充最新用户统计',async({page})=>{
  await page.route('**/api/state',async route=>{const response=await route.fetch(),state=await response.json();state.modules.server.data.memory.available=state.modules.server.data.memory.total*.05;state.modules.analytics.data={status:'unconfigured'};state.modules.realtime.data={status:'unconfigured'};await route.fulfill({response,json:state});});
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'有异常需要处理'})).toBeVisible();
  expect(await page.locator('.status-strip').evaluate(e=>e===e.parentElement.firstElementChild)).toBe(true);
  await expect(page.getByRole('meter',{name:'运行内存',exact:true})).toHaveClass(/danger/);await expect(page.getByRole('heading',{name:'连接谷歌，看见读者的变化'})).toBeVisible();await expect(page.getByRole('img',{name:'用户变化趋势'})).toHaveCount(0);
  await expect(page.getByRole('article',{name:'日活',exact:true}).locator('.circle-value')).toContainText('—');
  await page.getByLabel('用户数据类型').selectOption('registrations');await expect(page.getByRole('img',{name:'用户变化趋势'})).toBeVisible();
  await page.screenshot({path:path.join(dir,'verified-capacity-warning-fixture.png'),fullPage:true});
  await page.unroute('**/api/state');await page.route('**/api/state',async route=>{const response=await route.fetch(),state=await response.json();state.modules.server.status='error';state.modules.server.error='服务器只读查询失败';state.modules.analytics.status='error';state.modules.analytics.error='谷歌暂时无法连接';await route.fulfill({response,json:state});});
  await expect(page.getByText(/当前保留上次成功结果，不能当作最新数据/).first()).toBeVisible();await expect(page.getByRole('meter',{name:'运行内存',exact:true})).toHaveClass(/unknown/);await expect(page.getByRole('heading',{name:'已检查的关键项目正常'})).toHaveCount(0);
});
