import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestBackend, createTestDatabase } from '../../__tests__/helpers.js';
import type { StatsDatabase } from '../db/db.js';
import { VendorDomainEvidenceService } from './vendor-domain-evidence.service.js';
import { VendorAutomationService } from './vendor-automation.service.js';

function mockFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('rdap.org')) {
      return Response.json({
        registrars: [{ 0: 'vcard', 1: [['fn', {}, 'text', 'Acme Registrar']] }],
        entities: [
          { 0: 'vcard', 1: [['fn', {}, 'text', 'Acme Inc'], ['org', {}, 'text', 'Acme Inc']] },
        ],
      });
    }
    const title = url.includes('unclassified.example') ? 'EdgeCo CDN' : 'Acme CDN';
    return new Response(`<html><title>${title}</title></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }) as typeof fetch;
}

const originalEnv = { ...process.env };

describe('VendorAutomationService', () => {
  let db: StatsDatabase;
  let cleanup: () => void;
  let backendId: number;

  beforeEach(() => {
    ({ db, cleanup } = createTestDatabase());
    backendId = createTestBackend(db);
    db.createVendor({
      slug: 'acme',
      name: 'Acme CDN',
      priority: 100,
      rules: [{ pattern: 'acme-cdn.example', matchType: 'suffix' }],
    });
    db.updateTrafficStats(backendId, {
      domain: 'widget.example',
      ip: '192.0.2.40',
      chain: 'DIRECT',
      chains: ['DIRECT'],
      rule: 'Match',
      rulePayload: '',
      upload: 2_000_000,
      download: 3_000_000,
      connections: 5,
      sourceIP: '10.0.1.40',
      timestampMs: Date.now(),
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    cleanup();
  });

  it('auto-applies an unambiguous high-confidence domain suggestion', async () => {
    process.env.VENDOR_AUTOMATION_AUTO_APPLY = '1';
    const evidenceService = new VendorDomainEvidenceService(mockFetch(), {
      resolve4: async () => ['192.0.2.50'],
      resolve6: async () => [],
      resolveCname: async (domain) => domain === 'widget.example' ? ['edge.acme-cdn.example'] : [],
    });
    const service = new VendorAutomationService(db, undefined, evidenceService);
    const summary = await service.runNow();

    expect(summary.domainSubjects).toBe(1);
    expect(summary.suggestionsCreated).toBe(1);
    expect(summary.autoApplied).toBe(1);
    expect(summary.reclassification?.scannedRows).toBeGreaterThan(0);

    const acme = db.getVendors().find((vendor) => vendor.slug === 'acme');
    expect(acme?.rules.some((rule) => rule.pattern === 'widget.example' && rule.source === 'manual')).toBe(true);
    expect(db.repos.vendor.getSuggestions(backendId, 'applied')).toHaveLength(1);
  });

  it('does not auto-apply CDN infrastructure evidence without business signals', async () => {
    process.env.VENDOR_AUTOMATION_AUTO_APPLY = '1';
    db.createVendor({
      slug: 'edgeco',
      name: 'EdgeCo CDN',
      priority: 20,
      rules: [{ pattern: 'edgeco.example', matchType: 'suffix' }],
    });
    db.updateTrafficStats(backendId, {
      domain: 'unclassified.example',
      ip: '192.0.2.41',
      chain: 'DIRECT',
      chains: ['DIRECT'],
      rule: 'Match',
      rulePayload: '',
      upload: 2_000_000,
      download: 3_000_000,
      connections: 5,
      sourceIP: '10.0.1.41',
      timestampMs: Date.now(),
    });
    const evidenceService = new VendorDomainEvidenceService(mockFetch(), {
      resolve4: async () => ['192.0.2.51'],
      resolve6: async () => [],
      resolveCname: async (domain) => domain === 'unclassified.example' ? ['edge.edgeco.example'] : [],
    });
    const service = new VendorAutomationService(db, undefined, evidenceService);
    const summary = await service.runNow();

    expect(summary.suggestionsCreated).toBe(1);
    expect(summary.autoApplied).toBe(0);
    expect(db.repos.vendor.getSuggestions(backendId, 'pending').some(
      (suggestion) => suggestion.subject === 'unclassified.example' && suggestion.confidence === 'medium',
    )).toBe(true);
  });

  it('keeps suggestions pending when AUTO_APPLY=0', async () => {
    process.env.VENDOR_AUTOMATION_AUTO_APPLY = '0';
    const evidenceService = new VendorDomainEvidenceService(mockFetch(), {
      resolve4: async () => ['192.0.2.50'],
      resolve6: async () => [],
      resolveCname: async (domain) => domain === 'widget.example' ? ['edge.acme-cdn.example'] : [],
    });
    const service = new VendorAutomationService(db, undefined, evidenceService);
    const summary = await service.runNow();

    expect(summary.suggestionsCreated).toBe(1);
    expect(summary.autoApplied).toBe(0);
    const acme = db.getVendors().find((vendor) => vendor.slug === 'acme');
    expect(acme?.rules.some((rule) => rule.pattern === 'widget.example')).toBe(false);
    expect(db.repos.vendor.getSuggestions(backendId, 'pending')).toHaveLength(1);
  });
});
