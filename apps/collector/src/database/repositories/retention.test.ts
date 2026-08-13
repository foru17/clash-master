import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getAllSchemaStatements } from '../schema.js';
import { ConfigRepository } from './config.repository.js';

const BACKEND_ID = 1;

function createRawDb(): Database.Database {
  const db = new Database(':memory:');
  for (const stmt of getAllSchemaStatements()) {
    db.exec(stmt);
  }
  db.prepare(`
    INSERT INTO backend_configs (name, url, token, enabled, is_active, listening)
    VALUES ('test', 'http://127.0.0.1:9090', '', 1, 1, 1)
  `).run();
  return db;
}

function seedDimRows(db: Database.Database, isoMinute: string) {
  const hour = isoMinute.slice(0, 13) + ':00:00';
  db.prepare(`
    INSERT INTO minute_dim_stats (backend_id, minute, domain, ip, source_ip, chain, rule, upload, download, connections)
    VALUES (?, ?, 'a.com', '1.1.1.1', '', 'ProxyA', 'RuleA', 1, 1, 1)
  `).run(BACKEND_ID, isoMinute);
  db.prepare(`
    INSERT INTO hourly_dim_stats (backend_id, hour, domain, ip, source_ip, chain, rule, upload, download, connections)
    VALUES (?, ?, 'a.com', '1.1.1.1', '', 'ProxyA', 'RuleA', 1, 1, 1)
  `).run(BACKEND_ID, hour);
  db.prepare(`
    INSERT INTO hourly_country_stats (backend_id, hour, country, country_name, continent, upload, download, connections)
    VALUES (?, ?, 'US', 'United States', 'NA', 1, 1, 1)
  `).run(BACKEND_ID, hour);
}

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
}

describe('tiered retention', () => {
  let db: Database.Database;
  let repo: ConfigRepository;

  beforeEach(() => {
    db = createRawDb();
    repo = new ConfigRepository(db, ':memory:');
  });

  it('minute cutoff must not touch hourly dim/country tables', () => {
    seedDimRows(db, '2026-06-01T00:00:00');

    // 7-day style cutoff far after the seeded rows
    repo.deleteOldMinuteStats('2026-06-20T00:00:00.000Z');

    expect(count(db, 'minute_dim_stats')).toBe(0);
    expect(count(db, 'hourly_dim_stats')).toBe(1);
    expect(count(db, 'hourly_country_stats')).toBe(1);
  });

  it('hourly cutoff cleans hourly_stats plus hourly dim/country tables', () => {
    seedDimRows(db, '2026-06-01T00:00:00');
    db.prepare(`INSERT INTO hourly_stats (backend_id, hour, upload, download, connections) VALUES (?, '2026-06-01T00:00:00', 1, 1, 1)`).run(BACKEND_ID);

    repo.deleteOldHourlyStats('2026-06-20T00:00:00');

    expect(count(db, 'hourly_stats')).toBe(0);
    expect(count(db, 'hourly_dim_stats')).toBe(0);
    expect(count(db, 'hourly_country_stats')).toBe(0);
  });

  it('hourly cutoff keeps rows newer than the window', () => {
    seedDimRows(db, '2026-06-25T00:00:00');

    repo.deleteOldHourlyStats('2026-06-20T00:00:00');

    expect(count(db, 'hourly_dim_stats')).toBe(1);
  });

  it('stores forever independently for every retention tier', () => {
    const config = repo.updateRetentionConfig({
      connectionLogsDays: 'forever',
      hourlyStatsDays: 'forever',
      vendorHourlyDays: 'forever',
      vendorEndpointHourlyDays: 'forever',
      monitorMinuteDays: 'forever',
      monitorHourlyDays: 'forever',
    });
    expect(config).toMatchObject({
      connectionLogsDays: 'forever',
      hourlyStatsDays: 'forever',
      vendorHourlyDays: 'forever',
      vendorEndpointHourlyDays: 'forever',
      monitorMinuteDays: 'forever',
      monitorHourlyDays: 'forever',
    });
  });

  it('full cleanup removes vendor and availability history', () => {
    const vendorId = (db.prepare(`SELECT id FROM vendors WHERE slug = 'apple'`).get() as { id: number }).id;
    db.prepare(`
      INSERT INTO vendor_hourly_stats
        (backend_id, hour, source_ip, vendor_id, upload, download, connections)
      VALUES (?, '2026-06-01T00:00:00', '10.0.1.40', ?, 1, 1, 1)
    `).run(BACKEND_ID, vendorId);
    db.prepare(`
      INSERT INTO vendor_daily_stats
        (backend_id, day, source_ip, vendor_id, upload, download, connections)
      VALUES (?, '2026-06-01', '10.0.1.40', ?, 1, 1, 1)
    `).run(BACKEND_ID, vendorId);
    db.prepare(`
      INSERT INTO vendor_endpoint_hourly_stats
        (backend_id, hour, source_ip, vendor_id, endpoint_type, endpoint, transport, application_protocol, confidence, upload, download, connections)
      VALUES (?, '2026-06-01T00:00:00', '10.0.1.40', ?, 'domain', 'example.com', 'tcp', 'tls', 'exact', 1, 1, 1)
    `).run(BACKEND_ID, vendorId);
    const monitorId = Number(db.prepare(`
      INSERT INTO monitors (name, type, target) VALUES ('router', 'icmp', '10.0.1.1')
    `).run().lastInsertRowid);
    db.prepare(`
      INSERT INTO monitor_hourly_stats
        (monitor_id, hour, checks, up_checks, down_checks, degraded_checks, latency_sum, last_status)
      VALUES (?, '2026-06-01T00:00:00', 1, 1, 0, 0, 10, 'up')
    `).run(monitorId);
    db.prepare(`
      INSERT INTO monitor_incidents (monitor_id, started_at, status)
      VALUES (?, '2026-06-01T00:00:00.000Z', 'resolved')
    `).run(monitorId);

    repo.cleanupOldData(null, 0);

    expect(count(db, 'vendor_hourly_stats')).toBe(0);
    expect(count(db, 'vendor_daily_stats')).toBe(0);
    expect(count(db, 'vendor_endpoint_hourly_stats')).toBe(0);
    expect(count(db, 'monitor_hourly_stats')).toBe(0);
    expect(count(db, 'monitor_incidents')).toBe(0);
    expect(count(db, 'monitors')).toBe(1);
  });
});
