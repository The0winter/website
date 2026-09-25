import {test, expect} from '@playwright/test';
import {cachedReaderCounts, loadReaderCounts, rememberReaderCounts} from '../lib/reader-chapters';

test('failed or malformed count refreshes preserve the last valid badges and release requests for retry', async () => {
  const original = globalThis.fetch;
  try {
    const id = 'count-recovery';
    rememberReaderCounts(id, {paragraph: 4});
    for (const payload of [null, {}, {counts: null}, {counts: []}, {counts: {paragraph: -1}}, {counts: {paragraph: '4'}}]) {
      globalThis.fetch = async () => new Response(JSON.stringify(payload));
      await expect(loadReaderCounts(id, true)).rejects.toThrow('段评数据暂不可用');
      expect(cachedReaderCounts(id)).toEqual({paragraph: 4});
    }
    globalThis.fetch = async () => new Response('Unavailable', {status: 503});
    await expect(loadReaderCounts(id, true)).rejects.toThrow('段评暂不可用');
    expect(cachedReaderCounts(id)).toEqual({paragraph: 4});
    let calls = 0;
    globalThis.fetch = async () => {calls++; return new Response(JSON.stringify({counts: {paragraph: 5}}));};
    expect(await Promise.all([loadReaderCounts(id, true), loadReaderCounts(id, true)])).toEqual([{paragraph: 5}, {paragraph: 5}]);
    expect(calls).toBe(1);
    expect(await loadReaderCounts(id)).toEqual({paragraph: 5});
    expect(calls).toBe(1);
  } finally {globalThis.fetch = original;}
});
