const $ = id => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem('desktop-token');
if (token) sessionStorage.setItem('desktop-token', token);
history.replaceState(null, '', '/');
let data, selectedUrl = '', initialized = false, pollRunning = false, active = false, resultsKey = '', sitesKey = '';
let diagnosticKey = '', interruptionKey = '', libraryKey = '', libraryHelpKey = '', librarySubmitting = false, libraryDecisionPending = false;
const diagnostics = document.createElement('div');
diagnostics.id = 'task-diagnostics';
$('report-stats').after(diagnostics);
const attention = document.createElement('div');
attention.id = 'manual-attention'; attention.className = 'attention-box'; attention.hidden = true;
const attentionText = document.createElement('p'), showBrowser = document.createElement('button');
showBrowser.id = 'show-browser'; showBrowser.type = 'button'; showBrowser.className = 'secondary'; showBrowser.textContent = '显示采集窗口 ↗';
attention.append(attentionText, showBrowser); diagnostics.before(attention);
const libraryHelp = document.createElement('div'); libraryHelp.id = 'library-help'; libraryHelp.className = 'attention-box'; libraryHelp.hidden = true; libraryHelp.setAttribute('role', 'alert');
attention.after(libraryHelp);
const retryBook = document.createElement('button'), skipBook = document.createElement('button');
retryBook.id = 'library-retry'; retryBook.type = 'button'; retryBook.className = 'primary'; retryBook.textContent = '处理好了，重试这本'; retryBook.hidden = true;
skipBook.id = 'library-skip'; skipBook.type = 'button'; skipBook.className = 'secondary'; skipBook.textContent = '跳过，更新下一本'; skipBook.hidden = true;
const libraryDecisionBar = document.createElement('div'); libraryDecisionBar.className = 'task-actions';
libraryDecisionBar.append(retryBook, skipBook); libraryHelp.after(libraryDecisionBar);
const phases = {idle: '等待开始', upload: '正在上传', partial: '有未完成项', library: '整理书库', 'library-wait': '等待你处理', search: '查找中', ready: '等待选择', resolving: '读取目录', probe: '抽样检查', download: '正在下载', pausing: '正在暂停', paused: '已暂停', stopping: '正在停止', stopped: '已停止', probed: '试采通过', complete: '已完成', error: '采集中断'};
const working = phase => ['upload', 'library', 'library-wait', 'search', 'resolving', 'probe', 'download', 'pausing', 'stopping'].includes(phase);
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
  attentionText.textContent = waiting ? `需要你操作：方便时点击“显示采集窗口”，${task.action === 'login' ? '手动登录' : '手动完成验证码'}。完成后自动继续，已保存章节保留。${seconds === null ? '' : `剩余等待 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒。`}` : '';
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
  $('folder-nav').title = `打开已下载小说所在的目录：${data.outputDir}`;
  if (!initialized) {
    $('website').value = data.settings.lastWebsite || data.sites[0]?.home || '';
    if (!['upload', 'library'].includes(data.task.kind) && data.task.title) $('title').value = data.task.title;
    if (!['upload', 'library'].includes(data.task.kind) && data.task.author) $('author').value = data.task.author;
    initialized = true;
  }
  renderSettings(); adapterStatus();
  const task = data.task;
  active = task.busy || working(task.phase);
  const isUpload = task.kind === 'upload', isLibrary = task.kind === 'library', batch = isLibrary || isUpload ? task.batch : null;
  $('update-library').disabled = active || librarySubmitting;
  $('upload-library').disabled = active || librarySubmitting;
  $('upload-library').dataset.running = String(isUpload && active);
  $('upload-library-label').textContent = isUpload && active ? '正在上传' : '上传书库';
  $('update-library').dataset.running = String(isLibrary && active && task.phase !== 'library-wait');
  $('update-library-label').textContent = task.phase === 'library-wait' ? '等待处理' : isLibrary && active ? '正在更新' : '更新书库';
  document.title = task.phase === 'library-wait' ? '需要你处理 · 拾页' : '拾页 · 小说采集';
  for (const id of ['website', 'title', 'author', 'search', 'probe-only', 'clear-login']) $(id).disabled = active;
  for (const button of document.querySelectorAll('.site-choice')) button.disabled = active;
  $('search').textContent = task.phase === 'search' ? '正在查找…' : '查找书籍 →';
  const actionLabel = active && {login: '等待登录', verification: '等待验证', retrying: '自动重试'}[task.action];
  $('phase').textContent = actionLabel || phases[task.phase] || '等待开始';
  $('phase').className = `status-pill ${task.phase === 'library-wait' ? 'attention' : active ? 'running' : task.phase}`;
  $('stop').hidden = !active;
  $('stop').disabled = task.phase === 'stopping';
  $('stop').textContent = task.phase === 'stopping' ? '正在停止…' : '停止';
  const isEmpty = ['idle', 'ready'].includes(task.phase);
  $('task-empty').hidden = !isEmpty;
  $('task-content').hidden = isEmpty;
  $('task-title').textContent = isUpload && (!active || !task.title) ? '上传书库到网站' : isLibrary && (!active || !task.title) ? '本地书库更新' : task.title ? `《${task.title}》${task.author ? ` · ${task.author}` : ''}` : '采集任务';
  $('task-message').textContent = task.message;
  const report = task.report;
  const bookStatus = report ? report.status : task.status;
  const detection = report ? report.statusDetection : task.statusDetection;
  $('book-status').textContent = `作品状态：${bookStatus === '完结' ? '已完结' : bookStatus === '连载' ? '连载中' : task.phase === 'resolving' ? '正在读取…' : detection === 'conflict' ? '来源标注有冲突，待核对' : '未识别'}${detection === 'conflict-retained' ? '（来源仍标连载，保留已确认的完结状态）' : detection === 'retained' ? '（沿用已保存状态）' : ''}`;
  $('book-status').hidden = isLibrary || isUpload;
  const progress = !active && report ? {downloaded: report.downloaded, total: report.expected, failed: report.failures?.filter(item => item.chapter).length || 0, mode: report.mode || task.progress?.mode} : task.progress;
  const percent = progress?.total ? Math.min(100, progress.downloaded / progress.total * 100) : batch?.total ? batch.checked / batch.total * 100 : task.phase === 'complete' || task.phase === 'probed' ? 100 : 0;
  $('progress-bar').style.width = `${percent}%`;
  $('progress-bar').className = active && task.phase !== 'library-wait' && !progress?.total && !batch?.total ? 'indeterminate' : '';
  $('progress-text').textContent = isUpload ? (batch?.items.find(item => item.state === 'running')?.message || (active ? '正在连接网站…' : '')) : task.phase === 'library-wait' ? '等待处理期间不会读取下一本书' : progress?.total ? `${progress.mode === 'probe' ? '抽样' : '采集'} ${progress.downloaded} / ${progress.total} 章${progress.failed ? ` · ${progress.failed} 章失败` : ''}` : active ? '正在连接来源…' : '';
  $('pause').hidden = !['probe', 'download', 'pausing'].includes(task.phase);
  $('pause').disabled = task.phase === 'pausing';
  $('pause').textContent = task.phase === 'pausing' ? '正在保存…' : '暂停采集';
  $('report-stats').hidden = !report;
  if (report) $('report-stats').replaceChildren(...[[report.expected, report.continuation ? '本地书籍条目' : report.readingEdition ? '阅读版条目' : '目录章节'], [report.errors, '错误'], [report.warnings, '待核对']].map(([number, label]) => { const div = document.createElement('div'), strong = document.createElement('strong'); strong.textContent = number; div.append(strong, label); return div; }));
  renderDiagnostics(task);
  renderLibrary(batch);
  $('resume').hidden = isLibrary || isUpload || !['paused', 'stopped', 'probed', 'error'].includes(task.phase) || !task.sourceUrl;
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
      title.textContent = book.title; detail.textContent = `${book.author} · ${book.site}${book.status ? ` · ${book.status === '完结' ? '已完结' : '连载中'}` : ''}`; content.append(title, detail);
      if (book.local) { const status = document.createElement('small'); status.className = `local-state ${book.local.state}`; status.textContent = book.local.message; content.append(status); }
      label.append(radio, content); return label;
    }));
  }
  for (const radio of document.querySelectorAll('input[name=book]')) radio.disabled = active;
  const selected = data.candidates.find(book => book.url === selectedUrl);
  $('start').disabled = active || !selectedUrl || !!selected?.local?.blocked;
  $('start').textContent = selected?.local?.blocked ? '需先核对本地版本' : $('probe-only').checked ? (selected?.local?.continuation ? '检查衔接 →' : '开始试采 →') : selected?.local?.state === 'switch' ? '换源续更 ↓' : selected?.local?.state === 'complete' ? '检查更新 ↓' : selected?.local?.saved ? '继续采集 ↓' : '试采并下载 ↓';
  if (data.adapterErrors.length) feedback(`有站点配置需要修复：${data.adapterErrors.join('；')}`);
}
function renderLibrary(batch) {
  const upload = batch?.kind === 'upload';
  const current = batch?.items.find(item => ['running', 'retrying', 'waiting'].includes(item.state));
  const waiting = data.task.phase === 'library-wait' && current?.state === 'waiting';
  retryBook.hidden = !waiting;
  skipBook.hidden = upload || !current || !active;
  retryBook.disabled = skipBook.disabled = libraryDecisionPending || ['pausing', 'stopping'].includes(data.task.phase);
  libraryHelp.hidden = !waiting;
  const helpKey = waiting ? JSON.stringify([current.controlId, current.failure]) : '';
  if (helpKey !== libraryHelpKey) {
    libraryHelpKey = helpKey; libraryHelp.replaceChildren();
    if (waiting) {
      const heading = document.createElement('h4'); heading.textContent = `《${current.title}》需要你处理`;
      const note = document.createElement('p'); note.textContent = '这本书已暂停，已有章节保留。处理后点击“重试这本”；暂时处理不了，可以手动跳过。';
      libraryHelp.append(heading, failureNode(current.failure || {error: current.message}), note);
      libraryHelp.scrollIntoView({block: 'nearest'});
    }
  }
  $('library-summary').hidden = !batch;
  $('library-results').hidden = !batch?.items.length;
  $('library-summary').textContent = batch ? upload ? `已处理 ${batch.checked} / ${batch.total} 本 · 新书 ${batch.newBooks} 本 · 新增 ${batch.added} 章 · 已同步 ${batch.unchanged} 本${batch.failed ? ` · 未完成 ${batch.failed} 本` : ''}` : `已处理 ${batch.checked} / ${batch.total} 本 · 更新 ${batch.updated} 本 · 最新 ${batch.unchanged} 本 · 新增 ${batch.added} 章${batch.skipped ? ` · 跳过 ${batch.skipped} 本` : ''}` : '';
  const key = JSON.stringify(batch?.items);
  if (key === libraryKey) return;
  libraryKey = key;
  const labels = {pending: '等待检查', blocked: '需先核对', running: '检查中', retrying: '自动重试', waiting: '等待处理', updated: '已更新', uploaded: '已上传', unchanged: upload ? '已同步' : '已是最新', failed: upload ? '上传未完成' : '更新失败', skipped: '已手动跳过', stopped: '已停止'};
  $('library-results').replaceChildren(...(batch?.items || []).map(item => {
    const row = document.createElement('div'); row.className = 'library-row'; row.dataset.state = item.state;
    const heading = document.createElement('div'); heading.className = 'library-row-heading';
    const title = document.createElement('strong'), state = document.createElement('span'), message = document.createElement('p');
    title.textContent = `《${item.title}》${item.author ? ` · ${item.author}` : ''}`; state.textContent = labels[item.state] || item.state;
    let source = '';
    try { source = new URL(item.url).hostname + ' · '; } catch {}
    message.textContent = source + item.message;
    heading.append(title, state); row.append(heading, message);
    return row;
  }));
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
async function libraryDecision(action) {
  const current = data.task.batch?.items.find(item => ['running', 'retrying', 'waiting'].includes(item.state));
  if (!current || libraryDecisionPending) return;
  libraryDecisionPending = true; retryBook.disabled = skipBook.disabled = true;
  try { await api('library-action', {controlId: current.controlId, action}); }
  catch (error) { feedback(error.message); }
  finally { libraryDecisionPending = false; await poll(); }
}
retryBook.onclick = () => libraryDecision('retry');
skipBook.onclick = () => libraryDecision('skip');
$('update-library').onclick = async () => {
  if (active || librarySubmitting) return;
  librarySubmitting = true; $('update-library').disabled = true; feedback();
  try { await api('update-library', {}); }
  catch (error) { feedback(error.message); }
  finally { librarySubmitting = false; await poll(); }
};
$('upload-library').onclick = async () => {
  if (active || librarySubmitting) return;
  librarySubmitting = true; $('upload-library').disabled = $('update-library').disabled = true; feedback();
  try { await api('upload-library', {}); }
  catch (error) { feedback(error.message); }
  finally { librarySubmitting = false; await poll(); }
};
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
$('folder-nav').onclick = async () => {
  $('folder-nav').disabled = true;
  try { await api('open', {kind: 'folder'}); }
  catch (error) { feedback(error.message); }
  finally { $('folder-nav').disabled = false; }
};
document.querySelector('.brand').onclick = event => event.preventDefault();
await poll();
setInterval(poll, 1000);
