// Embedded Android browsers may expose AbortController without the newer
// AbortSignal static methods. Keep both cancellation and request deadlines.
export function requestSignal(source?: AbortSignal | null, timeoutMs = 15000): AbortSignal {
  if (typeof AbortSignal.timeout === 'function' && (!source || typeof AbortSignal.any === 'function')) {
    const timeout = AbortSignal.timeout(timeoutMs);
    return source ? AbortSignal.any([source, timeout]) : timeout;
  }
  const controller = new AbortController();
  const cancellationReason = () => source?.reason === undefined ? new DOMException('The request was aborted', 'AbortError') : source.reason;
  if (source?.aborted) {controller.abort(cancellationReason()); return controller.signal;}
  const abort = (reason: unknown) => {
    clearTimeout(timer);
    source?.removeEventListener('abort', cancel);
    controller.abort(reason);
  };
  const cancel = () => abort(cancellationReason());
  // The deadline also covers response-body reads. The fallback releases its
  // listener on cancellation or timeout, including requests that already ended.
  const timer = setTimeout(() => abort(new DOMException('The request timed out', 'TimeoutError')), timeoutMs);
  source?.addEventListener('abort', cancel, {once: true});
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  return controller.signal;
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason === undefined ? new DOMException('The request was aborted', 'AbortError') : signal.reason;
}
