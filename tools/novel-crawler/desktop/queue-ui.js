const $ = id => document.getElementById(id);
const done = item => ['complete', 'probed'].includes(item.state);
const live = item => ['running', 'searching'].includes(item.state);
const labels = {queued: '等待中', searching: '查找中', running: '采集中', waiting: '待确认', complete: '已完成', probed: '试采通过', error: '需处理', paused: '已暂停', stopped: '已停止'};

export function createQueueUI({api, poll, feedback}) {
  let data, key = '', mutating = false, timer, revision = Date.now(), latestDraft;
  const fields = () => ({website: $('website').value, title: $('title').value.trim(), author: $('author').value.trim(), probeOnly: $('probe-only').checked});
  function saveDraft() {
    latestDraft = {...fields(), revision: revision = Math.max(Date.now(), revision + 1)};
    $('draft-status').textContent = '正在保存输入…';
    clearTimeout(timer); timer = setTimeout(flushDraft, 250);
  }
  async function flushDraft() {
    const draft = latestDraft;
    if (!draft) return;
    try { await api('draft', draft); if (latestDraft === draft) $('draft-status').textContent = '输入已保存'; }
    catch { if (latestDraft === draft) $('draft-status').textContent = '输入暂未保存，请勿关闭窗口；继续编辑会重试。'; }
  }
  for (const id of ['website', 'title', 'author']) $(id).addEventListener('input', saveDraft);
  $('probe-only').addEventListener('change', saveDraft);
  addEventListener('pagehide', () => {
    clearTimeout(timer);
    if (latestDraft) fetch('/api/draft', {method: 'POST', keepalive: true, headers: {'Content-Type': 'application/json', 'x-desktop-token': sessionStorage.getItem('desktop-token') || ''}, body: JSON.stringify(latestDraft)}).catch(() => {});
  });
  async function change(action, body = {}, after) {
    if (mutating) return false;
    mutating = true;
    try { await api('queue/' + action, body); after?.(); key = ''; await poll(); return true; }
    catch (error) { feedback(error.message); return false; }
    finally { mutating = false; }
  }
  async function add(selected = false) {
    if (mutating || (!selected && !$('search-form').reportValidity())) return;
    const input = fields(), book = selected && data.candidates.find(book => book.url === document.querySelector('input[name=book]:checked')?.value);
    if (selected && !book) return;
    const body = book ? {...input, website: book.url, title: book.title, author: book.author, url: book.url} : input;
    await change('add', body, () => {
      feedback(`《${body.title}》已加入队列${data.queue?.paused ? '，继续队列后开始处理' : ''}。`, 'success');
      if (!selected && JSON.stringify(fields()) === JSON.stringify(input)) { $('title').value = ''; $('author').value = ''; saveDraft(); $('title').focus(); }
    });
  }
  $('enqueue').onclick = () => add();
  $('enqueue-selected').onclick = () => add(true);
  $('queue-toggle').onclick = () => change(data.queue.paused ? 'resume' : 'pause');
  $('queue-edit-cancel').onclick = () => $('queue-edit-dialog').close();
  $('queue-edit-form').onsubmit = async event => {
    event.preventDefault();
    if (mutating || !$('queue-edit-form').reportValidity()) return;
    mutating = true;
    try {
      await api('queue/edit', {id: $('queue-edit-id').value, website: $('queue-edit-website').value, title: $('queue-edit-book').value, author: $('queue-edit-author').value, probeOnly: $('queue-edit-probe').checked});
      $('queue-edit-dialog').close(); key = ''; await poll();
    } catch (error) { $('queue-edit-error').hidden = false; $('queue-edit-error').textContent = error.message; }
    finally { mutating = false; }
  };
  function edit(item) {
    $('queue-edit-id').value = item.id; $('queue-edit-website').value = item.input.website;
    $('queue-edit-book').value = item.input.title; $('queue-edit-author').value = item.input.author;
    $('queue-edit-probe').checked = item.input.probeOnly; $('queue-edit-error').hidden = true;
    $('queue-edit-dialog').showModal();
  }
  function row(item, index, items) {
    const root = document.createElement('article'); root.className = 'queue-row'; root.dataset.id = item.id; root.dataset.state = item.state;
    const heading = document.createElement('div'); heading.className = 'queue-row-heading';
    const title = document.createElement('strong'); title.textContent = item.book?.title || item.input.title;
    const state = document.createElement('span'); state.className = 'queue-state'; state.textContent = labels[item.state]; heading.append(title, state);
    const source = document.createElement('p'); source.className = 'queue-source';
    const host = new URL(item.input.website).hostname, site = data.sites.find(site => site.hosts.includes(host));
    source.textContent = `${item.book?.author || item.input.author || '作者待核对'} · ${site?.name || host}${item.input.probeOnly ? ' · 仅试采' : ''}`;
    const message = document.createElement('p'); message.className = 'queue-message'; message.textContent = item.message;
    root.append(heading, source, message);
    if (item.state === 'waiting') {
      const choices = document.createElement('div'); choices.className = 'queue-choices'; choices.setAttribute('aria-label', `为${item.input.title}选择书籍`);
      for (const book of item.candidates || []) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary';
        button.textContent = `${book.title} · ${book.author}${book.local?.blocked ? '（需核对本地版本）' : ' — 选择并继续'}`;
        button.disabled = !!book.local?.blocked;
        button.onclick = () => change('choose', {id: item.id, url: book.url}); choices.append(button);
      }
      root.append(choices);
    }
    if (!live(item)) {
      const actions = document.createElement('div'); actions.className = 'queue-row-actions';
      function button(label, action, disabled = false) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.textContent = label;
        button.setAttribute('aria-label', `${label}《${item.input.title}》`); button.disabled = disabled; button.onclick = action; actions.append(button);
      }
      if (!done(item)) {
        button('上移', () => change('move', {id: item.id, direction: -1}), index === 0 || live(items[index - 1]));
        button('下移', () => change('move', {id: item.id, direction: 1}), index === items.length - 1 || live(items[index + 1]));
        button('编辑', () => edit(item));
        if (['error', 'paused', 'stopped'].includes(item.state)) button('重试并继续', () => change('retry', {id: item.id}));
      }
      button('移除', () => change('remove', {id: item.id})); root.append(actions);
    }
    return root;
  }
  return {
    saveDraft,
    restoreDraft(draft) {
      if (!draft) return;
      for (const id of ['website', 'title', 'author']) $(id).value = draft[id] || '';
      $('probe-only').checked = draft.probeOnly === true; revision = Math.max(revision, draft.revision || 0);
      $('draft-status').textContent = '已恢复上次输入';
    },
    render(next, active) {
      data = next;
      const queue = data.queue || {items: [], paused: false};
      $('enqueue').disabled = !!queue.unavailable;
      const selected = data.candidates.find(book => book.url === document.querySelector('input[name=book]:checked')?.value);
      $('enqueue-selected').disabled = !selected || !!selected.local?.blocked || !!queue.unavailable || (active && selected.url === data.task.sourceUrl);
      $('queue-input-hint').textContent = active ? '当前任务继续运行；可以提前填写下一本并加入队列，轮到时再查找。' : '可先查找确认，也可输入完整书名后加入队列，依次查找并采集。';
      const pending = queue.items.filter(item => !done(item)), history = queue.items.filter(done);
      $('queue-count').textContent = pending.length;
      $('queue-toggle').hidden = !pending.length; $('queue-toggle').textContent = queue.paused ? '继续队列' : '暂停队列';
      $('queue-toggle').disabled = !!queue.unavailable || (queue.paused && pending[0]?.state === 'waiting');
      $('queue-toggle').title = queue.paused ? '继续按顺序处理队列' : '当前书继续完成，之后不再启动下一本';
      $('queue-summary').textContent = pending[0]?.state === 'waiting' ? '请先选择匹配书籍；其余任务已保留。' : queue.paused ? (pending.some(live) ? '队列已暂停，当前书会继续完成。' : '队列已暂停，点击“继续队列”后依次处理。') : pending.length ? (active ? '按顺序逐本处理，当前任务完成后继续。' : '按顺序逐本处理；需要你核对时会暂停。') : '按顺序逐本采集，关闭后保留队列。';
      $('queue-warning').hidden = !queue.error; $('queue-warning').textContent = queue.error || '';
      $('queue-empty').hidden = !!pending.length;
      const nextKey = JSON.stringify(queue.items);
      if (key !== nextKey) {
        key = nextKey; $('queue-list').replaceChildren(...pending.map((item, index) => row(item, index, pending)));
        $('queue-history-list').replaceChildren(...history.map((item, index) => row(item, index, history)));
      }
      $('queue-history').hidden = !history.length; $('queue-history-summary').textContent = `已完成 ${history.length} 本`;
    }
  };
}
