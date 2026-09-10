const $ = id => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem('desktop-token');
if (token) sessionStorage.setItem('desktop-token', token);
history.replaceState(null, '', '/');
let data, selectedUrl = '', initialized = false, pollRunning = false, active = false, resultsKey = '', recentKey = '', sitesKey = '';
const phases = {idle: '等待开始', search: '查找中', ready: '等待选择', resolving: '读取目录', probe: '抽样检查', download: '正在下载', pausing: '正在暂停', paused: '已暂停', probed: '试采通过', complete: '已完成', error: '需要处理'};
const working = phase => ['search', 'resolving', 'probe', 'download', 'pausing'].includes(phase);
async function api(action, body) {
  const response = await fetch(`/api/${action}`, {method: body === undefined ? 'GET' : 'POST', headers: {'x-desktop-token': token || '', 'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '操作失败');
  return result;
}
function feedback(message = '') { $('feedback').textContent = message; $('feedback').hidden = !message; }
function adapterStatus() {
  let host;
  try { host = new URL($('website').value.includes('://') ? $('website').value : `https://${$('website').value}`).hostname; } catch {}
  const found = data?.sites.find(site => site.hosts.includes(host));
  $('adapter-status').textContent = found ? '✓ 已适配' : host ? '待适配' : '输入网址';
  $('adapter-status').className = `input-tag ${found ? 'supported' : host ? 'unsupported' : ''}`;
  $('form-note').textContent = found || !host ? '下次打开时，会保留上次使用的网站。' : '把网址发给 Codex，即可继续适配这个来源。';
}
function chooseWebsite(url) { $('website').value = url; adapterStatus(); remember(); }
async function remember() { if (!$('website').value.trim()) return; try { const settings = await api('remember', {website: $('website').value}); if (data) { data.settings = settings; renderSettings(); } } catch {} }
function renderSettings() {
  const nextRecentKey = JSON.stringify(data.settings.recentWebsites);
  if (nextRecentKey !== recentKey) {
    recentKey = nextRecentKey;
    const buttons = data.settings.recentWebsites.map(url => { const button = document.createElement('button'); button.type = 'button'; button.className = 'recent-chip'; button.textContent = new URL(url).hostname; button.title = url; button.onclick = () => chooseWebsite(url); return button; });
    if (buttons.length) $('recent').replaceChildren(...buttons);
  }
  const nextSitesKey = JSON.stringify(data.sites);
  if (nextSitesKey !== sitesKey) {
    sitesKey = nextSitesKey;
    $('site-count').textContent = data.sites.length;
    $('sites').replaceChildren(...data.sites.map(site => { const button = document.createElement('button'); button.type = 'button'; button.className = 'site-choice'; button.textContent = site.name; const small = document.createElement('small'); small.textContent = new URL(site.home).hostname; button.append(small); button.onclick = () => chooseWebsite(site.home); return button; }));
  }
}
function render() {
  if (!initialized) {
    $('website').value = data.settings.lastWebsite || data.sites[0]?.home || '';
    if (data.task.title) $('title').value = data.task.title;
    if (data.task.author) $('author').value = data.task.author;
    initialized = true;
  }
  renderSettings(); adapterStatus();
  const task = data.task;
  active = working(task.phase);
  for (const id of ['website', 'title', 'author', 'search', 'probe-only']) $(id).disabled = active;
  for (const button of document.querySelectorAll('.recent-chip,.site-choice')) button.disabled = active;
  $('search').textContent = task.phase === 'search' ? '正在查找…' : '查找书籍 →';
  $('phase').textContent = phases[task.phase] || '等待开始';
  $('phase').className = `status-pill ${active ? 'running' : task.phase}`;
  const isEmpty = ['idle', 'ready'].includes(task.phase);
  $('task-empty').hidden = !isEmpty;
  $('task-content').hidden = isEmpty;
  $('task-title').textContent = task.title ? `《${task.title}》${task.author ? ` · ${task.author}` : ''}` : '采集任务';
  $('task-message').textContent = task.message;
  const progress = task.progress, report = task.report;
  const percent = progress?.total ? Math.min(100, progress.downloaded / progress.total * 100) : task.phase === 'complete' || task.phase === 'probed' ? 100 : 0;
  $('progress-bar').style.width = `${percent}%`;
  $('progress-bar').className = active && !progress?.total ? 'indeterminate' : '';
  $('progress-text').textContent = progress?.total ? `${progress.mode === 'probe' ? '抽样' : '采集'} ${progress.downloaded} / ${progress.total} 章${progress.failed ? ` · ${progress.failed} 章失败` : ''}` : active ? '正在连接来源…' : '';
  $('pause').hidden = !['probe', 'download', 'pausing'].includes(task.phase);
  $('pause').disabled = task.phase === 'pausing';
  $('pause').textContent = task.phase === 'pausing' ? '正在保存…' : '暂停采集';
  $('report-stats').hidden = !report;
  if (report) $('report-stats').replaceChildren(...[[`${report.downloaded} / ${report.expected}`, '已采集章节'], [report.errors, '检测到的错误'], [report.warnings, '待核对警告']].map(([number, label]) => { const div = document.createElement('div'), strong = document.createElement('strong'); strong.textContent = number; div.append(strong, label); return div; }));
  $('open-folder').hidden = !report?.exportFile;
  $('open-report').hidden = !report?.jobId;
  $('resume').hidden = !['paused', 'probed', 'error'].includes(task.phase) || !task.sourceUrl;
  $('results-panel').hidden = !data.candidates.length;
  const nextKey = JSON.stringify(data.candidates);
  if (nextKey !== resultsKey) {
    resultsKey = nextKey;
    selectedUrl = data.candidates[0]?.url || '';
    $('results').replaceChildren(...data.candidates.map((book, i) => { const label = document.createElement('label'); label.className = 'book-result'; const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'book'; radio.value = book.url; radio.checked = i === 0; radio.onchange = () => { selectedUrl = book.url; }; const content = document.createElement('span'), title = document.createElement('strong'), detail = document.createElement('small'); title.textContent = book.title; detail.textContent = `${book.author} · ${book.site}`; content.append(title, detail); label.append(radio, content); return label; }));
  }
  for (const radio of document.querySelectorAll('input[name=book]')) radio.disabled = active;
  $('start').disabled = active || !selectedUrl;
  $('start').textContent = $('probe-only').checked ? '开始试采 →' : '试采并下载 ↓';
  if (data.adapterErrors.length) feedback(`有站点配置需要修复：${data.adapterErrors.join('；')}`);
}
async function poll() { if (pollRunning) return; pollRunning = true; try { data = await api('state'); render(); } catch (error) { feedback(error.message === 'Failed to fetch' ? '程序连接已断开，请关闭窗口后重新打开。' : error.message); } finally { pollRunning = false; } }
async function search(event) {
  event?.preventDefault();
  if (!$('search-form').reportValidity() || active) return;
  feedback(); $('search').disabled = true;
  try {
    const result = await api('search', {website: $('website').value, title: $('title').value.trim(), author: $('author').value.trim()});
    if (!result.candidates.length) feedback(result.task.message);
    await poll();
  } catch (error) { feedback(error.message); await poll(); }
}
$('search-form').addEventListener('submit', search);
$('website').addEventListener('input', adapterStatus);
$('website').addEventListener('change', remember);
$('probe-only').addEventListener('change', () => { if (data) render(); });
$('start').onclick = async () => { feedback(); $('start').disabled = true; try { await api('start', {url: selectedUrl, probeOnly: $('probe-only').checked}); } catch (error) { feedback(error.message); } await poll(); };
$('pause').onclick = async () => { try { await api('pause', {}); } catch (error) { feedback(error.message); } await poll(); };
$('resume').onclick = async () => { if (data.task.title) $('title').value = data.task.title; if (data.task.author) $('author').value = data.task.author; if (data.task.sourceUrl) $('website').value = data.task.sourceUrl; $('probe-only').checked = false; await search(); $('results-panel').scrollIntoView({behavior: 'smooth', block: 'nearest'}); };
for (const id of ['folder-nav', 'open-folder', 'open-report']) $(id).onclick = async () => { try { await api('open', {kind: id === 'open-report' ? 'report' : 'folder'}); } catch (error) { feedback(error.message); } };
document.querySelector('.brand').onclick = event => event.preventDefault();
await poll();
setInterval(poll, 1000);
