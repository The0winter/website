import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicWrite, readJson} from '../storage.mjs';
import {normalizeWebsite} from './sources.mjs';

const states = new Set(['queued', 'searching', 'running', 'waiting', 'complete', 'probed', 'error', 'stopped', 'paused']);
const finished = item => ['complete', 'probed'].includes(item.state);
export const queueInput = input => {
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 ||
      (input.author !== undefined && (typeof input.author !== 'string' || input.author.length > 200))) throw Error('请填写有效的书名和作者');
  return {website: normalizeWebsite(input.website), title: input.title.trim(), author: (input.author || '').trim(), probeOnly: input.probeOnly === true};
};
const same = (a, b) => a.website === b.website && a.title === b.title && a.author === b.author && a.probeOnly === b.probeOnly;

export function createBookQueue(stateDir) {
  const file = path.join(stateDir, 'desktop-queue.json');
  let value = {version: 1, paused: false, items: [], draft: null}, loadError = '', persistenceError = '';
  try {
    const saved = readJson(file);
    if (saved) {
      if (saved.version !== 1 || typeof saved.paused !== 'boolean' || !Array.isArray(saved.items) || saved.items.length > 130 ||
          saved.items.some(item => !item?.id || !states.has(item.state) || !item.input) || new Set(saved.items.map(item => item.id)).size !== saved.items.length) throw Error('队列记录格式无效');
      saved.items.forEach(item => queueInput(item.input));
      value = saved;
      // Restarting restores intent and checkpoints, never launches a browser.
      if (value.items.some(item => !finished(item))) value = {...value, paused: true, items: value.items.map(item => ['searching', 'running'].includes(item.state) ? {...item, state: 'queued', message: '上次任务中断，继续队列后会核对已保存进度'} : item)};
    }
  } catch { loadError = '队列记录无法读取，原文件已保留；请先修复 desktop-queue.json。'; }
  function commit(next) {
    if (loadError) throw Error(loadError);
    try { atomicWrite(file, next); value = next; persistenceError = ''; }
    catch (error) { persistenceError = '队列暂未保存，已暂停启动后续任务；请稍后重试。'; throw Error(persistenceError, {cause: error}); }
  }
  function change(id, edit) {
    if (!value.items.some(item => item.id === id)) throw Error('这项任务已移除，请刷新队列');
    commit({...value, items: value.items.map(item => item.id === id ? edit(structuredClone(item)) : item)});
  }
  const editable = item => { if (['running', 'searching'].includes(item.state)) throw Error('当前任务正在处理，请先停止再修改'); };
  return {
    snapshot: () => structuredClone({...value, error: loadError || persistenceError, unavailable: !!loadError}),
    next: () => !value.paused && !loadError && !persistenceError ? value.items.find(item => !finished(item)) : undefined,
    hasWork: () => value.items.some(item => !finished(item)),
    add(input, book) {
      const fields = queueInput(input);
      if (value.items.some(item => !finished(item) && (same(item.input, fields) || (book && item.book?.url === book.url)))) throw Error('这本书已经在队列中');
      if (value.items.filter(item => !finished(item)).length >= 100) throw Error('队列最多保存100本待处理书籍');
      const item = {id: randomUUID(), input: fields, book, state: 'queued', message: book ? '等待采集' : '等待查找', createdAt: new Date().toISOString()};
      const history = value.items.filter(finished).sort((a, b) => (a.completedOrder || 0) - (b.completedOrder || 0)).slice(-29);
      commit({...value, items: [...value.items.filter(item => !finished(item)), item, ...history]});
      return item;
    },
    edit(id, input) {
      const fields = queueInput(input);
      if (value.items.some(item => item.id !== id && !finished(item) && same(item.input, fields))) throw Error('这本书已经在队列中');
      change(id, item => { editable(item); return {...item, input: fields, book: undefined, candidates: undefined, state: 'queued', message: '等待重新查找'}; });
    },
    remove(id) {
      const item = value.items.find(item => item.id === id); if (!item) return;
      editable(item); commit({...value, items: value.items.filter(item => item.id !== id)});
    },
    move(id, direction) {
      if (![1, -1].includes(direction)) throw Error('调整顺序参数无效');
      const items = [...value.items], index = items.findIndex(item => item.id === id), next = index + direction;
      if (index < 0 || next < 0 || next >= items.length) return;
      editable(items[index]); editable(items[next]);
      if (finished(items[index]) || finished(items[next])) return;
      [items[index], items[next]] = [items[next], items[index]]; commit({...value, items});
    },
    mark: (id, values) => change(id, item => ({...item, ...values})),
    finish(id, task) {
      const state = ['complete', 'probed', 'paused', 'stopped'].includes(task.phase) ? task.phase : 'error';
      const completedOrder = Math.max(0, ...value.items.map(item => item.completedOrder || 0)) + 1;
      const items = value.items.map(item => item.id === id ? {...item, state, message: task.message, report: task.report, candidates: undefined, completedOrder} : item);
      const keep = new Set(items.filter(finished).sort((a, b) => (a.completedOrder || 0) - (b.completedOrder || 0)).slice(-30).map(item => item.id));
      commit({...value, items: items.filter(item => !finished(item) || keep.has(item.id)), paused: value.paused || !['complete', 'probed'].includes(state)});
    },
    pause() { if (value.items.length) commit({...value, paused: true}); },
    resume() {
      const first = value.items.find(item => !finished(item));
      if (first?.state === 'waiting') throw Error('请先为待确认任务选择书籍，或移除这项任务');
      commit({...value, paused: false, items: value.items.map(item => item.id === first?.id && ['error', 'stopped', 'paused'].includes(item.state) ? {...item, state: 'queued', message: '等待继续'} : item)});
    },
    choose(id, url) {
      const item = value.items.find(item => item.id === id), book = item?.state === 'waiting' && item.candidates?.find(book => book.url === url);
      if (!book) throw Error('匹配结果已变化，请重新查找');
      if (book.local?.blocked) throw Error(book.local.message);
      change(id, item => ({...item, book, candidates: undefined, state: 'queued', message: '书籍已确认，等待采集'}));
    },
    retry(id) { change(id, item => { editable(item); return {...item, state: 'queued', candidates: undefined, message: '等待重试'}; }); },
    draft(input) {
      if (!Number.isSafeInteger(input.revision) || input.revision < 1 || typeof input.website !== 'string' || input.website.length > 2000 ||
          typeof input.title !== 'string' || input.title.length > 200 || typeof input.author !== 'string' || input.author.length > 200) throw Error('输入草稿无效');
      if (input.revision <= (value.draft?.revision || 0)) return;
      commit({...value, draft: {website: input.website, title: input.title, author: input.author, probeOnly: input.probeOnly === true, revision: input.revision}});
    }
  };
}
