const $ = id => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem('desktop-token');
if (token) sessionStorage.setItem('desktop-token', token);
history.replaceState(null, '', '/');
let data, selectedUrl = '', initialized = false, pollRunning = false, active = false, resultsKey = '', sitesKey = '';
let diagnosticKey = '', interruptionKey = '';
const diagnostics = document.createElement('div');
diagnostics.id = 'task-diagnostics';
$('report-stats').after(diagnostics);
const attention = document.createElement('div');
attention.id = 'manual-attention'; attention.className = 'attention-box'; attention.hidden = true;
const attentionText = document.createElement('p'), showBrowser = document.createElement('button');
showBrowser.id = 'show-browser'; showBrowser.type = 'button'; showBrowser.className = 'secondary'; showBrowser.textContent = '显示采集窗口 ↗';
attention.append(attentionText, showBrowser); diagnostics.before(attention);
const phases = {idle: '等待开始', search: '查找中', ready: '等待选择', resolving: '读取目录', probe: '抽样检查', download: '正在下载', pausing: '正在暂停', paused: '已暂停', stopping: '正在停止', stopped: '已停止', probed: '试采通过', complete: '已完成', error: '采集中断'};
const working = phase => ['search', 'resolving', 'probe', 'download', 'pausing', 'stopping'].includes(phase);
async function api(action, body) {
  const response = await fetch(`/api/${action}`, {method: body === undefined ? 'GET' : 'POST', headers: {'x-desktop-token': token || '', 'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '操作失败');
  return result;
}
function feedback(message = '', kind = 'error') {
  $('feedback').textContent = message; $('feedback').hidden = !message;
  $('feedback').dataset.kind = kind;
  $('feedback').setAttribute('role', kind === 'error' ? 'alert' : 'status');
}
function failureNode(failure) {
  const item = document.createElement('div'); item.className = 'failure-item';
  const title = document.createElement('strong'), reason = document.createElement('p'), next = document.createElement('p');
  title.textContent = failure.chapter ? `目录第 ${failure.chapter} 项 · ${failure.title || '未命名章节'}` : '任务中断原因';
  reason.textContent = failure.error;
  next.className = 'next-step'; next.textContent = `下一步：${failure.nextStep || '请核对来源页面，或将质量报告交给 Codex 排查。'}`;
  item.append(title, reason, next);
  try {
    const url = new URL(failure.url || failure.link);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
      const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = '查看失败来源页 ↗'; item.append(link);
    }
  } catch {}
  return item;
}
function renderDiagnostics(task) {
  const waiting = active && ['login', 'verification'].includes(task.action);
  attention.hidden = !waiting;
  const seconds = task.actionDeadline ? Math.max(0, Math.ceil((task.actionDeadline - Date.now()) / 1000)) : null;
  attentionText.textContent = waiting ? `需要你操作：${task.action === 'login' ? '请在采集窗口手动登录' : '请在采集窗口手动完成验证码'}。完成后自动继续，已保存章节保留。${seconds === null ? '' : `剩余等待 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒。`}` : '';
  showBrowser.hidden = !task.canShowBrowser;
  const failures = task.report?.failures?.length ? task.report.failures : task.failure ? [task.failure] : task.phase === 'error' ? [{error: task.message}] : [];
  const visible = !active && failures.length && !['ready', 'idle'].includes(task.phase);
  diagnostics.hidden = !visible;
  const key = JSON.stringify([visible, failures]);
  if (key !== diagnosticKey) {
    diagnosticKey = key;
    diagnostics.replaceChildren();
    if (visible) {
      const heading = document.createElement('h4'); heading.textContent = `失败详情（${failures.length} 项）`;
      diagnostics.append(heading, ...failures.slice(0, 20).map(failureNode));
      if (failures.length > 20) { const more = document.createElement('p'); more.textContent = '其余失败项见质量报告。'; diagnostics.append(more); }
    }
  }
  if (task.phase !== 'error') { interruptionKey = ''; if ($('interruption-dialog').open) $('interruption-dialog').close(); return; }
  const errorKey = JSON.stringify([task.title, task.report?.checkedAt, task.message, failures]);
  if (errorKey === interruptionKey) return;
  interruptionKey = errorKey;
  $('interruption-summary').textContent = task.report ? `已保留 ${task.report.downloaded} / ${task.report.expected} 章，本次没有生成完整书籍。失败详情会保留在进度区。` : task.message;
  $('interruption-detail').replaceChildren(...failures.slice(0, 1).map(failureNode));
  if (!$('interruption-dialog').open) $('interruption-dialog').showModal();
}
function adapterStatus() {
  let host;
  try { host = new URL($('website').value.includes('://') ? $('website').value : `https://${$('website').value}`).hostname; } catch {}
  const found = data?.sites.find(site => site.hosts.includes(host));
  $('login-memory').hidden = !found?.remembersLogin;
  $('clear-login').disabled = active;
  $('clear-login').title = found ? `清除${found.name}在拾页中的登录信息，下次重新登录；已保存章节保留` : '';
  $('adapter-status').textContent = found ? '✓ 已适配' : host ? '待适配' : '输入网址';
  $('adapter-status').className = `input-tag ${found ? 'supported' : host ? 'unsupported' : ''}`;
  $('form-note').hidden = !!found || !host;
  $('form-note').textContent = '此来源待适配，请将网址发给 Codex。';
  for (const button of document.querySelectorAll('.site-choice')) {
    const selected = found ? button.dataset.siteId === found.id : button.dataset.host === host;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}
function chooseWebsite(url) { $('website').value = url; adapterStatus(); remember(); }
async function remember() { if (!$('website').value.trim()) return; try { const settings = await api('remember', {website: $('website').value}); if (data) { data.settings = settings; renderSettings(); adapterStatus(); $('sites').scrollTop = 0; } } catch {} }
function renderSettings() {
  const nextSitesKey = JSON.stringify([data.sites, data.settings.recentWebsites]);
  if (nextSitesKey !== sitesKey) {
    sitesKey = nextSitesKey;
    const rows = [], seen = new Set();
    for (const url of [...data.settings.recentWebsites, ...data.sites.map(site => site.home)]) {
      const host = new URL(url).hostname;
      const site = data.sites.find(site => site.hosts.includes(host));
      const key = site ? `site:${site.id}` : url;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({url, host, site});
    }
    $('site-count').textContent = rows.length;
    $('sites').replaceChildren(...rows.map(({url, host, site}) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'site-choice'; button.title = url;
      button.dataset.host = host; button.dataset.siteId = site?.id || '';
      button.disabled = working(data.task.phase);
      const heading = document.createElement('span'), name = document.createElement('span'), status = document.createElement('span');
      heading.className = 'site-choice-heading'; name.className = 'site-choice-name'; name.textContent = site?.name || host;
      status.className = `site-state ${site ? 'adapted' : 'pending'}`;
      status.textContent = site ? '已适配' : '待适配';
      heading.append(name, status); button.append(heading);
      if (site) { const small = document.createElement('small'); small.textContent = host; button.append(small); }
      button.onclick = () => chooseWebsite(url);
      return button;
    }));
  }
}
function render() {
  for (const id of ['folder-nav', 'open-folder']) $(id).title = `打开已下载小说所在的目录：${data.outputDir}`;
  if (!initialized) {
    $('website').value = data.settings.lastWebsite || data.sites[0]?.home || '';
    if (data.task.title) $('title').value = data.task.title;
    if (data.task.author) $('author').value = data.task.author;
    initialized = true;
  }
  renderSettings(); adapterStatus();
  const task = data.task;
  active = working(task.phase);
  for (const id of ['website', 'title', 'author', 'search', 'probe-only', 'clear-login']) $(id).disabled = active;
  for (const button of document.querySelectorAll('.site-choice')) button.disabled = active;
  $('search').textContent = task.phase === 'search' ? '正在查找…' : '查找书籍 →';
  const actionLabel = active && {login: '等待登录', verification: '等待验证'}[task.action];
  $('phase').textContent = actionLabel || phases[task.phase] || '等待开始';
  $('phase').className = `status-pill ${active ? 'running' : task.phase}`;
  $('stop').hidden = !active;
  $('stop').disabled = task.phase === 'stopping';
  $('stop').textContent = task.phase === 'stopping' ? '正在停止…' : '停止';
  const isEmpty = ['idle', 'ready'].includes(task.phase);
  $('task-empty').hidden = !isEmpty;
  $('task-content').hidden = isEmpty;
  $('task-title').textContent = task.title ? `《${task.title}》${task.author ? ` · ${task.author}` : ''}` : '采集任务';
  $('task-message').textContent = task.message;
  const report = task.report;
  const description = report?.description || task.description;
  $('task-description').hidden = !description && !report?.descriptionStatus;
  $('description-status').textContent = description ? report?.descriptionStatus === 'truncated' ? '已截取前 5000 字符' : report?.descriptionStatus === 'retained' ? '沿用已保存简介' : '已获取' : '未获取';
  $('description-text').textContent = description || '来源未提供可用简介，本次文件不包含简介。';
  const progress = !active && report ? {downloaded: report.downloaded, total: report.expected, failed: report.failures?.filter(item => item.chapter).length || 0, mode: report.mode || task.progress?.mode} : task.progress;
  const percent = progress?.total ? Math.min(100, progress.downloaded / progress.total * 100) : task.phase === 'complete' || task.phase === 'probed' ? 100 : 0;
  $('progress-bar').style.width = `${percent}%`;
  $('progress-bar').className = active && !progress?.total ? 'indeterminate' : '';
  $('progress-text').textContent = progress?.total ? `${progress.mode === 'probe' ? '抽样' : '采集'} ${progress.downloaded} / ${progress.total} 章${progress.failed ? ` · ${progress.failed} 章失败` : ''}` : active ? '正在连接来源…' : '';
  $('pause').hidden = !['probe', 'download', 'pausing'].includes(task.phase);
  $('pause').disabled = task.phase === 'pausing';
  $('pause').textContent = task.phase === 'pausing' ? '正在保存…' : '暂停采集';
  $('report-stats').hidden = !report;
  if (report) $('report-stats').replaceChildren(...[[report.expected, '目录章节'], [report.errors, '错误'], [report.warnings, '待核对']].map(([number, label]) => { const div = document.createElement('div'), strong = document.createElement('strong'); strong.textContent = number; div.append(strong, label); return div; }));
  renderDiagnostics(task);
  $('open-folder').hidden = !report?.exportFile;
  $('open-report').hidden = !report?.jobId;
  $('resume').hidden = !['paused', 'stopped', 'probed', 'error'].includes(task.phase) || !task.sourceUrl;
  $('results-panel').hidden = !data.candidates.length;
  const nextKey = JSON.stringify(data.candidates);
  if (nextKey !== resultsKey) {
    resultsKey = nextKey;
    if (!data.candidates.some(book => book.url === selectedUrl)) selectedUrl = data.candidates[0]?.url || '';
    $('results').replaceChildren(...data.candidates.map(book => {
      const label = document.createElement('label'); label.className = 'book-result';
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'book'; radio.value = book.url; radio.checked = book.url === selectedUrl;
      radio.onchange = () => { selectedUrl = book.url; render(); };
      const content = document.createElement('span'), title = document.createElement('strong'), detail = document.createElement('small');
      title.textContent = book.title; detail.textContent = `${book.author} · ${book.site}`; content.append(title, detail);
      if (book.local) { const status = document.createElement('small'); status.className = `local-state ${book.local.state}`; status.textContent = book.local.message; content.append(status); }
      label.append(radio, content); return label;
    }));
  }
  for (const radio of document.querySelectorAll('input[name=book]')) radio.disabled = active;
  $('start').disabled = active || !selectedUrl;
  const selected = data.candidates.find(book => book.url === selectedUrl);
  $('start').textContent = $('probe-only').checked ? '开始试采 →' : selected?.local?.state === 'complete' ? '检查更新 ↓' : selected?.local?.saved ? '继续采集 ↓' : '试采并下载 ↓';
  if (data.adapterErrors.length) feedback(`有站点配置需要修复：${data.adapterErrors.join('；')}`);
}
async function poll() { if (pollRunning) return; pollRunning = true; try { data = await api('state'); render(); } catch (error) { feedback(error.message === 'Failed to fetch' ? '程序连接已断开，请关闭窗口后重新打开。' : error.message); } finally { pollRunning = false; } }
async function search(event) {
  event?.preventDefault();
  if (!$('search-form').reportValidity() || active) return;
  feedback(); $('search').disabled = true;
  try {
    const result = await api('search', {website: $('website').value, title: $('title').value.trim(), author: $('author').value.trim()});
    if (!result.candidates.length && result.task.phase !== 'stopped') feedback(result.task.message);
    await poll();
  } catch (error) { feedback(error.message); await poll(); }
}
$('search-form').addEventListener('submit', search);
$('website').addEventListener('input', adapterStatus);
$('website').addEventListener('change', remember);
$('clear-login').onclick = async () => {
  if (active) return;
  $('clear-login').disabled = true;
  try { const result = await api('clear-login', {website: $('website').value}); feedback(result.message); }
  catch (error) { feedback(error.message); }
  finally { $('clear-login').disabled = active; }
};
$('probe-only').addEventListener('change', () => { if (data) render(); });
$('start').onclick = async () => { feedback(); $('start').disabled = true; try { await api('start', {url: selectedUrl, probeOnly: $('probe-only').checked}); } catch (error) { feedback(error.message); } await poll(); };
$('pause').onclick = async () => { try { await api('pause', {}); } catch (error) { feedback(error.message); } await poll(); };
$('stop').onclick = async () => { $('stop').disabled = true; try { await api('stop', {}); } catch (error) { feedback(error.message); } await poll(); };
showBrowser.onclick = async () => { showBrowser.disabled = true; try { await api('show-browser', {}); } catch (error) { feedback(error.message); } finally { showBrowser.disabled = false; } };
$('dismiss-interruption').onclick = () => { $('interruption-dialog').close(); $('task-diagnostics').scrollIntoView({block: 'nearest'}); };
$('resume').onclick = async () => { if (data.task.title) $('title').value = data.task.title; if (data.task.author) $('author').value = data.task.author; if (data.task.sourceUrl) $('website').value = data.task.sourceUrl; $('probe-only').checked = false; await search(); $('results-panel').scrollIntoView({behavior: 'smooth', block: 'nearest'}); };
const openButtons = ['folder-nav', 'open-folder', 'open-report'].map($);
for (const button of openButtons) button.onclick = async () => {
  openButtons.forEach(item => { item.disabled = true; });
  feedback('正在打开目录…', 'info');
  try { const result = await api('open', {kind: button.id === 'open-report' ? 'report' : 'folder'}); feedback(result.message, 'info'); }
  catch (error) { feedback(error.message); }
  finally { openButtons.forEach(item => { item.disabled = false; }); }
};
document.querySelector('.brand').onclick = event => event.preventDefault();
await poll();
setInterval(poll, 1000);
