import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeUpdate } from './relative-update.ts';

const now = Date.parse('2026-09-10T18:00:00Z');
const hour = 3_600_000;
const ago = hours => new Date(now - hours * hour).toISOString();

test('relative updates switch at hour, day, month and year boundaries', () => {
  for (const [hours, expected] of [
    [0, '1小时内更新'], [0.99, '1小时内更新'],
    [1, '1小时前更新'], [23.99, '23小时前更新'],
    [24, '1天前更新'], [29.99 * 24, '29天前更新'],
    [30 * 24, '1个月前更新'], [60 * 24, '2个月前更新'],
    [364 * 24, '12个月前更新'], [365 * 24, '1年前更新'],
    [730 * 24, '2年前更新'],
  ]) assert.equal(formatRelativeUpdate(ago(hours), now), expected);
});

test('timezone offsets describe the same instant and invalid dates never invent recency', () => {
  assert.equal(formatRelativeUpdate('2026-09-11T00:00:00+08:00', now), '2小时前更新');
  assert.equal(formatRelativeUpdate(ago(-1), now), '1小时内更新');
  for (const value of [undefined, '', 'invalid']) {
    assert.equal(formatRelativeUpdate(value, now), '更新时间未知');
  }
});
