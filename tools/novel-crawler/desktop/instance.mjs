// A reachable service does not necessarily own a desktop window. Background
// supervision must not make a later shortcut click silently disappear.
export async function focusExistingDesktop(previous, {fetcher = fetch} = {}) {
  if (!Number.isInteger(previous?.port) || previous.port < 1 || previous.port > 65535 || !previous.token) return false;
  const base = `http://127.0.0.1:${previous.port}`;
  const headers = {'x-desktop-token': previous.token};
  let response;
  try {
    response = await fetcher(`${base}/api/focus`, {method: 'POST', headers, signal: AbortSignal.timeout(2000)});
  } catch { return false; }
  if (!response.ok) return false;
  const result = await response.json();
  if (result.focused === true || result.ok === true && result.focused === undefined && !previous.backgroundSupervision) return true;
  // Legacy background services used to return only {ok:true}. Check their
  // activity before allowing a fresh desktop to read the same saved state.
  const stateResponse = await fetcher(`${base}/api/state`, {headers, signal: AbortSignal.timeout(2000)});
  if (!stateResponse.ok) throw Error('无法核对后台采集状态，请稍后重新打开拾页。');
  const state = await stateResponse.json();
  if (state.task?.busy || state.queue?.paused === false && state.queue.items?.some(item => ['queued', 'searching', 'running'].includes(item.state))) {
    throw Error('拾页正在后台采集，请等本轮任务保存结束后再打开窗口；已保存进度不会丢失。');
  }
  return false;
}
