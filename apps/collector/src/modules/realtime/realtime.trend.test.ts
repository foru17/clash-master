import { describe, expect, it } from 'vitest';
import { RealtimeMerger } from './realtime.merger.js';
import { RealtimeStore } from './realtime.store.js';

const backendId = 1;
const nowMs = Date.parse('2026-07-23T15:00:00Z');

function createStore(): RealtimeStore {
  const store = new RealtimeStore();
  store.minuteByBackend.set(backendId, new Map([
    ['2026-07-23T03:37:00', { upload: 1, download: 2, lastUpdated: nowMs }],
    ['2026-07-23T14:37:00', { upload: 3, download: 4, lastUpdated: nowMs }],
  ]));
  return store;
}

describe('realtime trend bucketing', () => {
  it('groups RealtimeStore traffic from the same UTC day into one daily bucket', () => {
    const store = createStore();

    expect(store.mergeTrend(backendId, [], 24 * 60, 24 * 60, nowMs)).toEqual([
      { time: '2026-07-23T00:00:00', upload: 4, download: 6 },
    ]);
  });

  it('groups RealtimeMerger traffic from the same UTC day into one daily bucket', () => {
    const store = createStore();
    const merger = new RealtimeMerger(store);

    expect(merger.mergeTrend(backendId, [], 24 * 60, 24 * 60, nowMs)).toEqual([
      { time: '2026-07-23T00:00:00', upload: 4, download: 6 },
    ]);
  });
});
