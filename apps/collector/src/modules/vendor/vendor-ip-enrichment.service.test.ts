import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestBackend, createTestDatabase } from '../../__tests__/helpers.js';
import type { StatsDatabase } from '../db/db.js';
import { VendorIPEnrichmentService } from './vendor-ip-enrichment.service.js';

describe('VendorIPEnrichmentService', () => {
  let db: StatsDatabase;
  let cleanup: () => void;
  let backendId: number;

  beforeEach(() => {
    ({ db, cleanup } = createTestDatabase());
    backendId = createTestBackend(db);
  });

  afterEach(() => cleanup());

  it('uses a dominant locally observed domain before external DNS', () => {
    const vendor = db.createVendor({
      slug: 'local-evidence',
      name: 'Local Evidence',
      rules: [{ pattern: 'media.example.test', matchType: 'suffix' }],
    });
    db.updateTrafficStats(backendId, {
      domain: 'edge.media.example.test',
      ip: '192.0.2.40',
      chain: 'DIRECT',
      chains: ['DIRECT'],
      rule: 'Match',
      rulePayload: '',
      upload: 100,
      download: 900,
      connections: 5,
      sourceIP: '10.0.1.40',
      timestampMs: Date.now(),
    });
    const service = new VendorIPEnrichmentService(db);
    expect(service.prepare(['192.0.2.40'])).toBe(true);
    expect(db.repos.vendor.getIPDomainEnrichment('192.0.2.40')).toMatchObject({
      status: 'resolved',
      domain: 'edge.media.example.test',
      vendorId: vendor.id,
      source: 'observed',
      confidence: 'high',
      evidenceConnections: 5,
    });
  });

  it('accepts PTR only when forward DNS maps back to the same IP', async () => {
    const vendor = db.createVendor({
      slug: 'ptr-evidence',
      name: 'PTR Evidence',
      rules: [{ pattern: 'ptr.example.test', matchType: 'suffix' }],
    });
    const resolver = {
      reverse: async () => ['edge.ptr.example.test.'],
      resolve4: async () => ['203.0.113.8'],
      resolve6: async () => [],
    };
    const service = new VendorIPEnrichmentService(db, undefined, resolver);
    expect(service.prepare(['203.0.113.8'])).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(db.repos.vendor.getIPDomainEnrichment('203.0.113.8')).toMatchObject({
      status: 'resolved',
      domain: 'edge.ptr.example.test',
      vendorId: vendor.id,
      source: 'ptr',
      forwardConfirmed: true,
    });
  });

  it('caches an unconfirmed PTR as unresolved', async () => {
    const resolver = {
      reverse: async () => ['misleading.example.test.'],
      resolve4: async () => ['203.0.113.99'],
      resolve6: async () => [],
    };
    const service = new VendorIPEnrichmentService(db, undefined, resolver);
    service.prepare(['203.0.113.9']);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(db.repos.vendor.getIPDomainEnrichment('203.0.113.9')).toMatchObject({
      status: 'unresolved',
      domain: null,
      vendorId: null,
    });
  });
});
