import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestBackend, createTestDatabase } from '../../__tests__/helpers.js';
import type { StatsDatabase } from '../../modules/db/db.js';

describe('VendorRepository', () => {
  let db: StatsDatabase;
  let cleanup: () => void;
  let backendId: number;

  beforeEach(() => {
    ({ db, cleanup } = createTestDatabase());
    backendId = createTestBackend(db);
  });

  afterEach(() => cleanup());

  it('classifies suffixes with label boundaries and writes hourly and daily rollups', () => {
    const timestampMs = Date.parse('2026-08-12T10:30:00.000Z');
    db.batchUpdateTrafficStats(backendId, [
      {
        domain: 'r1---sn.googlevideo.com', ip: '1.1.1.1', chain: 'DIRECT', chains: ['DIRECT'],
        rule: 'Match', rulePayload: '', upload: 100, download: 900,
        connections: 2, sourceIP: '10.0.1.50', timestampMs,
        network: 'tcp', destinationPort: 443,
      },
      {
        domain: 'notgooglevideo.com', ip: '2.2.2.2', chain: 'DIRECT', chains: ['DIRECT'],
        rule: 'Match', rulePayload: '', upload: 10, download: 20,
        connections: 1, sourceIP: '10.0.1.50', timestampMs,
        network: 'udp', destinationPort: 443,
      },
    ]);

    const stats = db.getVendorStats(
      backendId,
      '2026-08-12T00:00:00.000Z',
      '2026-08-12T23:59:59.999Z',
    );
    const google = stats.totals.find((item) => item.vendorSlug === 'google');
    const unknown = stats.totals.find((item) => item.vendorSlug === 'unknown');
    expect(google).toMatchObject({ upload: 100, download: 900, connections: 2 });
    expect(unknown).toMatchObject({ upload: 10, download: 20, connections: 1 });
    expect(stats.byDevice.find((item) => item.vendorSlug === 'google')?.sourceIP).toBe('10.0.1.50');
    expect(stats.trend).toHaveLength(2);
    expect(stats.quality).toMatchObject({
      totalTraffic: 1030,
      recognizedTraffic: 1000,
      domainObservedTraffic: 1030,
    });
    expect(stats.quality.totalRecognitionRate).toBeCloseTo(1000 / 1030);
    expect(stats.protocols).toEqual(expect.arrayContaining([
      expect.objectContaining({ vendorSlug: 'google', transport: 'tcp', applicationProtocol: 'tls' }),
      expect.objectContaining({ vendorSlug: 'unknown', transport: 'udp', applicationProtocol: 'quic' }),
    ]));
    expect(db.repos.vendor.getEndpointStats(
      backendId,
      google!.vendorId,
      '2026-08-12T00:00:00.000Z',
      '2026-08-12T23:59:59.999Z',
    )).toMatchObject({
      granularity: 'hour',
      endpoints: [
        {
          endpointType: 'domain',
          endpoint: 'r1---sn.googlevideo.com',
          upload: 100,
          download: 900,
          applicationProtocol: 'tls',
        },
      ],
    });
    expect(db.repos.vendor.getUnknownCandidates(backendId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ registrableDomain: 'notgooglevideo.com', download: 20 }),
    ]));
  });

  it('supports custom vendor rules without changing the traffic write path', () => {
    const vendor = db.createVendor({
      slug: 'example-co',
      name: 'Example Co',
      rules: [{ pattern: 'example.test', matchType: 'suffix', priority: 500 }],
    });
    db.updateTrafficStats(backendId, {
      domain: 'api.example.test', ip: '192.0.2.1', chain: 'DIRECT', chains: ['DIRECT'],
      rule: 'Match', rulePayload: '', upload: 5, download: 15,
      sourceIP: '10.0.1.88', timestampMs: Date.now(),
    });
    const stats = db.getVendorStats(
      backendId,
      new Date(Date.now() - 60_000).toISOString(),
      new Date(Date.now() + 60_000).toISOString(),
    );
    expect(stats.totals.find((item) => item.vendorId === vendor.id)).toMatchObject({
      upload: 5,
      download: 15,
    });
  });

  it('reclassifies high-confidence enriched IP endpoints in vendor views without rewriting raw rollups', () => {
    const timestampMs = Date.now();
    const bytedance = db.getVendors().find((vendor) => vendor.slug === 'bytedance')!;
    const unknown = db.getVendors().find((vendor) => vendor.slug === 'unknown')!;
    db.updateTrafficStats(backendId, {
      domain: '', ip: '49.7.200.54', chain: 'DIRECT', chains: ['DIRECT'],
      rule: 'Match', rulePayload: '', upload: 100, download: 900,
      connections: 2, sourceIP: '10.0.1.50', timestampMs,
      network: 'udp', destinationPort: 9681,
    });
    db.repos.vendor.saveIPDomainEnrichment({
      ip: '49.7.200.54', status: 'resolved', domain: 'signal-t1-v4-az1.rtcxyz.com',
      vendorId: bytedance.id, source: 'observed', confidence: 'high',
      evidenceConnections: 3, evidenceShare: 1, forwardConfirmed: true, ttlHours: 24,
    });

    const rangeStart = new Date(timestampMs - 60_000).toISOString();
    const rangeEnd = new Date(timestampMs + 60_000).toISOString();
    const stats = db.getVendorStats(backendId, rangeStart, rangeEnd);
    expect(stats.totals.find((item) => item.vendorId === bytedance.id)).toMatchObject({
      upload: 100, download: 900, connections: 2,
    });
    expect(stats.totals.find((item) => item.vendorId === unknown.id)).toBeUndefined();
    expect(stats.quality.recognizedTraffic).toBe(1000);
    expect(db.repos.vendor.getEndpointStats(
      backendId, bytedance.id, rangeStart, rangeEnd,
    ).endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        endpointType: 'ip', endpoint: '49.7.200.54',
        resolvedVendorName: 'ByteDance', resolutionConfidence: 'high',
      }),
    ]));
    expect(db.repos.vendor.getEndpointStats(
      backendId, unknown.id, rangeStart, rangeEnd,
    ).endpoints).toHaveLength(0);

    const rawDb = (db as unknown as { db: Database.Database }).db;
    expect(rawDb.prepare(`
      SELECT vendor_id FROM vendor_endpoint_hourly_stats
      WHERE backend_id = ? AND endpoint = ?
    `).get(backendId, '49.7.200.54')).toMatchObject({ vendor_id: unknown.id });
  });

  it('keeps manual rules above built-in classification and rejects cross-vendor conflicts', () => {
    const vendor = db.createVendor({ slug: 'my-video', name: 'My Video' });
    db.updateVendor(vendor.id, {
      rules: [{ pattern: 'rtcxyz.com', matchType: 'suffix', priority: 1 }],
    });
    const timestampMs = Date.now();
    db.updateTrafficStats(backendId, {
      domain: 'signal.rtcxyz.com', ip: '192.0.2.9', chain: 'DIRECT', chains: ['DIRECT'],
      rule: 'Match', rulePayload: '', upload: 1, download: 9,
      sourceIP: '10.0.1.90', timestampMs,
    });
    expect(db.getVendorStats(
      backendId,
      new Date(timestampMs - 60_000).toISOString(),
      new Date(timestampMs + 60_000).toISOString(),
    ).totals.find((item) => item.vendorId === vendor.id)).toBeDefined();

    const other = db.createVendor({ slug: 'other-video', name: 'Other Video' });
    expect(() => db.updateVendor(other.id, {
      rules: [{ pattern: 'rtcxyz.com', matchType: 'suffix' }],
    })).toThrow('already belongs');
  });

  it('recognizes high-confidence home domains and prefers business aliases over CDN infrastructure', () => {
    const timestampMs = Date.parse('2026-08-13T08:30:00.000Z');
    const base = {
      ip: '192.0.2.10', chain: 'DIRECT', chains: ['DIRECT'],
      rule: 'Match', rulePayload: '', connections: 1,
      sourceIP: '10.0.1.58', timestampMs,
    };
    db.batchUpdateTrafficStats(backendId, [
      {
        ...base, domain: 'signal-t1-v4-az2-01.rtcxyz.com',
        upload: 100, download: 900, network: 'udp', destinationPort: 9681,
      },
      {
        ...base, domain: 'v9-be-pack.pglstatp-toutiao.com.bsgslb.com',
        upload: 10, download: 90, network: 'tcp', destinationPort: 443,
      },
      {
        ...base, domain: 'v6-be-pack.pglstatp-toutiao.com.download.ks-cdn.com',
        upload: 20, download: 80, network: 'tcp', destinationPort: 443,
      },
      {
        ...base, domain: 'dualstack.h2.bytedance.map.fastly.net',
        upload: 30, download: 70, network: 'tcp', destinationPort: 443,
      },
      {
        ...base, domain: 'apac-asia-courier-vs.push-apple.com.akadns.net',
        upload: 40, download: 60, network: 'tcp', destinationPort: 443,
      },
      {
        ...base, domain: 'a29.us.akamai.net',
        upload: 5, download: 45, network: 'tcp', destinationPort: 443,
      },
      {
        ...base, domain: 'vpn1.office1006.xlhb.com',
        upload: 50, download: 50, network: 'tcp', destinationPort: 443,
      },
      {
        ...base, domain: 'u.thsi.cn',
        upload: 5, download: 5, network: 'tcp', destinationPort: 443,
      },
      {
        ...base, domain: 'router-mqtt01-shcp-link.ztehome.com.cn',
        upload: 4, download: 6, network: 'tcp', destinationPort: 443,
      },
      {
        ...base, domain: 'speedtest1.online.sh.cn',
        upload: 500, download: 500, network: 'tcp', destinationPort: 443,
      },
      {
        ...base, domain: 'api.ipinfo.es',
        upload: 3, download: 7, network: 'tcp', destinationPort: 443,
      },
    ]);

    const stats = db.getVendorStats(
      backendId,
      '2026-08-13T00:00:00.000Z',
      '2026-08-13T23:59:59.999Z',
    );
    expect(stats.totals.find((item) => item.vendorSlug === 'bytedance')).toMatchObject({
      upload: 160,
      download: 1140,
      connections: 4,
    });
    expect(stats.totals.find((item) => item.vendorSlug === 'apple')).toMatchObject({
      upload: 40,
      download: 60,
    });
    expect(stats.totals.find((item) => item.vendorSlug === 'akamai')).toMatchObject({
      upload: 5,
      download: 45,
    });
    expect(stats.totals.find((item) => item.vendorSlug === 'self-hosted-office')).toMatchObject({
      upload: 50,
      download: 50,
    });
    expect(stats.totals.find((item) => item.vendorSlug === 'tonghuashun')).toBeDefined();
    expect(stats.totals.find((item) => item.vendorSlug === 'zte')).toBeDefined();
    expect(stats.totals.find((item) => item.vendorSlug === 'shanghai-online')).toMatchObject({
      upload: 500,
      download: 500,
    });
    expect(stats.totals.find((item) => item.vendorSlug === 'ipinfo-es')).toBeDefined();
    expect(stats.protocols).toEqual(expect.arrayContaining([
      expect.objectContaining({ vendorSlug: 'bytedance', transport: 'udp', applicationProtocol: 'other' }),
      expect.objectContaining({ vendorSlug: 'bytedance', transport: 'tcp', applicationProtocol: 'tls' }),
    ]));
  });

  it('reclassifies recent history and rebuilds unknown candidates after rules change', () => {
    const timestampMs = Date.now() - 60 * 60 * 1000;
    db.updateTrafficStats(backendId, {
      domain: 'video.future-vendor.test', ip: '192.0.2.8', chain: 'DIRECT', chains: ['DIRECT'],
      rule: 'Match', rulePayload: '', upload: 50, download: 950,
      sourceIP: '10.0.1.77', timestampMs,
    });
    expect(db.repos.vendor.getUnknownCandidates(backendId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ registrableDomain: 'future-vendor.test' }),
    ]));

    const vendor = db.createVendor({
      slug: 'future-vendor',
      name: 'Future Vendor',
      rules: [{ pattern: 'future-vendor.test', matchType: 'suffix' }],
    });
    const result = db.repos.vendor.reclassifyRecentHistory(30);
    expect(result.scannedRows).toBeGreaterThan(0);

    const stats = db.getVendorStats(
      backendId,
      new Date(timestampMs - 60_000).toISOString(),
      new Date(timestampMs + 60_000).toISOString(),
    );
    expect(stats.totals.find((item) => item.vendorId === vendor.id)).toMatchObject({
      upload: 50,
      download: 950,
    });
    expect(db.repos.vendor.getUnknownCandidates(backendId)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ registrableDomain: 'future-vendor.test' }),
    ]));
  });

  it('preserves daily history when requested backfill exceeds retained domain detail', () => {
    const oldTimestampMs = Date.now() - 60 * 24 * 60 * 60 * 1000;
    db.updateTrafficStats(backendId, {
      domain: 'old.example.test', ip: '192.0.2.60', chain: 'DIRECT', chains: ['DIRECT'],
      rule: 'Match', rulePayload: '', upload: 25, download: 75,
      sourceIP: '10.0.1.60', timestampMs: oldTimestampMs,
    });
    const rawDb = (db as unknown as { db: Database.Database }).db;
    const oldDay = new Date(oldTimestampMs).toISOString().slice(0, 10);
    rawDb.prepare(`DELETE FROM hourly_dim_stats WHERE backend_id = ? AND hour LIKE ?`).run(backendId, `${oldDay}%`);

    db.updateTrafficStats(backendId, {
      domain: 'recent.example.test', ip: '192.0.2.61', chain: 'DIRECT', chains: ['DIRECT'],
      rule: 'Match', rulePayload: '', upload: 10, download: 90,
      sourceIP: '10.0.1.61', timestampMs: Date.now() - 60 * 60 * 1000,
    });
    db.repos.vendor.reclassifyRecentHistory(365);

    const preserved = rawDb.prepare(`
      SELECT SUM(upload + download) AS traffic
      FROM vendor_daily_stats
      WHERE backend_id = ? AND day = ?
    `).get(backendId, oldDay) as { traffic: number | null };
    expect(preserved.traffic).toBe(100);
  });
});
