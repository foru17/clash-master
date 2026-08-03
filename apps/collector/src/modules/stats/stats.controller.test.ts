import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestBackend, createTestDatabase } from '../../__tests__/helpers.js';
import { createApp } from '../app/app.js';
import type { StatsDatabase } from '../db/db.js';
import { realtimeStore } from '../realtime/realtime.store.js';

describe('StatsController', () => {
  let app: FastifyInstance;
  let backendId: number;
  let cleanup: () => void;
  let db: StatsDatabase;

  beforeEach(async () => {
    ({ db, cleanup } = createTestDatabase());
    backendId = createTestBackend(db);
    app = await createApp({
      port: 0,
      db,
      realtimeStore,
      logger: false,
      autoListen: false,
    });
  });

  afterEach(async () => {
    await app.close();
    realtimeStore.clearBackend(backendId);
    cleanup();
  });

  it('accepts a daily bucket for aggregated traffic trends', async () => {
    const baseUpdate = {
      domain: 'example.com',
      ip: '203.0.113.1',
      chain: 'DIRECT',
      chains: ['DIRECT'],
      rule: 'Match',
      rulePayload: '',
    };
    db.batchUpdateTrafficStats(backendId, [
      {
        ...baseUpdate,
        upload: 1,
        download: 2,
        timestampMs: Date.parse('2026-07-23T03:37:00Z'),
      },
      {
        ...baseUpdate,
        upload: 3,
        download: 4,
        timestampMs: Date.parse('2026-07-23T14:37:00Z'),
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: `/api/stats/trend/aggregated?backendId=${backendId}&start=2026-07-23T00%3A00%3A00Z&end=2026-07-23T23%3A59%3A59Z&minutes=1440&bucketMinutes=1440`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { time: '2026-07-23T00:00:00', upload: 4, download: 6 },
    ]);
  });
});
