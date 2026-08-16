import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app.js';
import { createTestBackend, createTestDatabase } from '../../__tests__/helpers.js';
import { realtimeStore } from '../realtime/realtime.store.js';
import type { StatsDatabase } from '../db/db.js';

describe('Home monitoring API', () => {
  let db: StatsDatabase;
  let cleanup: () => void;
  let backendId: number;
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ db, cleanup } = createTestDatabase());
    backendId = createTestBackend(db);
    app = await createApp({ port: 0, db, realtimeStore, autoListen: false });
  });

  afterEach(async () => {
    await app.close();
    realtimeStore.clearBackend(backendId);
    cleanup();
  });

  it('serves vendor analytics and availability CRUD from the unified API', async () => {
    const now = Date.now();
    db.updateTrafficStats(backendId, {
      domain: 'chatgpt.com', ip: '203.0.113.10', chain: 'Proxy', chains: ['Proxy'],
      rule: 'Match', rulePayload: '', upload: 200, download: 800,
      sourceIP: '10.0.1.50', timestampMs: now,
    });

    const vendorResponse = await app.inject({
      method: 'GET',
      url: `/api/vendors/stats?backendId=${backendId}&start=${encodeURIComponent(new Date(now - 60_000).toISOString())}&end=${encodeURIComponent(new Date(now + 60_000).toISOString())}`,
    });
    expect(vendorResponse.statusCode).toBe(200);
    expect(vendorResponse.json().totals).toEqual(expect.arrayContaining([
      expect.objectContaining({ vendorSlug: 'openai', download: 800 }),
    ]));

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/monitors',
      payload: {
        name: 'QTS port', type: 'tcp', target: '10.0.1.9', port: 5000,
        intervalSeconds: 60, timeoutMs: 2000, failureThreshold: 3,
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const monitor = createResponse.json() as { id: number; status: string };
    expect(monitor.status).toBe('pending');

    const listResponse = await app.inject({ method: 'GET', url: '/api/monitors' });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: monitor.id, name: 'QTS port' }),
    ]));

    const deleteResponse = await app.inject({ method: 'DELETE', url: `/api/monitors/${monitor.id}` });
    expect(deleteResponse.statusCode).toBe(200);
  });

  it('serves vendor automation status and applies pending suggestions', async () => {
    const vendor = db.createVendor({ slug: 'testco', name: 'TestCo' });
    const created = db.repos.vendor.upsertSuggestion({
      backendId,
      subjectType: 'domain',
      subject: 'widget.test',
      suggestedVendorId: vendor.id,
      confidence: 'high',
      score: 90,
      reasons: ['cname:edge.testco.test'],
      trafficBytes: 2_000_000,
      devices: 1,
    });
    expect(created.created).toBe(true);

    const automationResponse = await app.inject({
      method: 'GET',
      url: `/api/vendors/automation?backendId=${backendId}`,
    });
    expect(automationResponse.statusCode).toBe(200);
    const automation = automationResponse.json() as {
      suggestions?: Array<{ id: number }>;
      evidenceStats?: { pendingSuggestionCount: number };
      snifferImpact?: { totalTraffic: number };
    };
    expect(automation.suggestions).toHaveLength(1);
    expect(automation.evidenceStats?.pendingSuggestionCount).toBe(1);
    expect(automation.snifferImpact?.totalTraffic).toBeTypeOf('number');

    const applyResponse = await app.inject({
      method: 'POST',
      url: `/api/vendors/suggestions/${created.id}/apply`,
    });
    expect(applyResponse.statusCode).toBe(200);
    expect(db.getVendors().find((item) => item.id === vendor.id)?.rules.some(
      (rule) => rule.pattern === 'widget.test' && rule.source === 'manual',
    )).toBe(true);
  });
});
