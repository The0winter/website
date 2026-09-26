import {test, expect} from '@playwright/test';
import {requestSignal} from '../lib/request-signal';
import {safeFetch, catalogPages} from '../lib/request';

const originalFetch = globalThis.fetch;
const any = Object.getOwnPropertyDescriptor(AbortSignal, 'any')!;
const timeout = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')!;
const throwIfAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'throwIfAborted')!;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(AbortSignal, 'any', any);
  Object.defineProperty(AbortSignal, 'timeout', timeout);
  Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', throwIfAborted);
});

for (const missing of ['any', 'timeout', 'both']) test(`request deadline survives missing ${missing}`, async () => {
  if (missing !== 'timeout') Object.defineProperty(AbortSignal, 'any', {...any, value: undefined});
  if (missing !== 'any') Object.defineProperty(AbortSignal, 'timeout', {...timeout, value: undefined});
  const signal = requestSignal(new AbortController().signal, 15);
  globalThis.fetch = async () => new Response(new ReadableStream({start(stream) {
    signal.addEventListener('abort', () => stream.error(signal.reason), {once: true});
  }}));
  const response = await safeFetch('https://example.test/catalog', {signal});
  // Resolving headers must not cancel the timeout while the body is stalled.
  await expect(response.text()).rejects.toMatchObject({name: 'TimeoutError'});
});

test('fallback preserves cancellation and releases the parent listener', () => {
  Object.defineProperty(AbortSignal, 'any', {...any, value: undefined});
  const parent = new AbortController();
  let removed = 0;
  const remove = parent.signal.removeEventListener.bind(parent.signal);
  parent.signal.removeEventListener = (...args: Parameters<typeof remove>) => {removed++; remove(...args);};
  const signal = requestSignal(parent.signal);
  const reason = new DOMException('Navigation changed', 'AbortError');
  parent.abort(reason);
  expect(signal.aborted).toBe(true);
  expect(signal.reason).toBe(reason);
  expect(removed).toBe(1);
  expect(requestSignal(parent.signal).reason).toBe(reason);
});

test('default reads and catalog cancellation work without any newer signal method', async () => {
  Object.defineProperty(AbortSignal, 'timeout', {...timeout, value: undefined});
  Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', {...throwIfAborted, value: undefined});
  const controller = new AbortController(); let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++; expect(init?.signal).toBeInstanceOf(AbortSignal);
    return new Response(JSON.stringify(Array.from({length: 200}, (_, id) => ({id}))), {headers: {'X-Total-Count': '400'}});
  };
  await expect(catalogPages('https://example.test/chapters', {signal: controller.signal, onProgress: () => controller.abort()})).rejects.toMatchObject({name: 'AbortError'});
  expect(calls).toBe(1);
});
