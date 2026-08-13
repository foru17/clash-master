import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getAllSchemaStatements } from '../database/schema.js';

const days = Math.max(1, Number.parseInt(process.env.BENCHMARK_DAYS || '365', 10));
const devices = Math.max(1, Number.parseInt(process.env.BENCHMARK_DEVICES || '20', 10));
const activeVendorsPerDevice = Math.max(1, Number.parseInt(process.env.BENCHMARK_VENDORS_PER_DEVICE || '3', 10));
const protocolsPerVendor = Math.max(1, Math.min(4, Number.parseInt(process.env.BENCHMARK_PROTOCOLS_PER_VENDOR || '2', 10)));
const endpointsPerVendor = Math.max(1, Number.parseInt(process.env.BENCHMARK_ENDPOINTS_PER_VENDOR || '3', 10));
const endpointHourlyRetentionDays = Math.min(
  days,
  Math.max(1, Number.parseInt(process.env.BENCHMARK_VENDOR_ENDPOINT_HOURLY_DAYS || '90', 10)),
);
const unresolvedDomainsPerDevice = Math.max(0, Number.parseInt(process.env.BENCHMARK_UNRESOLVED_DOMAINS_PER_DEVICE || '5', 10));
const monitors = Math.max(1, Number.parseInt(process.env.BENCHMARK_MONITORS || '14', 10));
const minuteRetentionDays = Math.min(days, Math.max(1, Number.parseInt(process.env.BENCHMARK_MONITOR_MINUTE_DAYS || '30', 10)));

const directory = mkdtempSync(path.join(tmpdir(), 'neko-home-benchmark-'));
const dbPath = path.join(directory, 'benchmark.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = OFF');
for (const statement of getAllSchemaStatements()) db.exec(statement);
const backendId = Number(db.prepare(`
  INSERT INTO backend_configs (name, url, type, enabled, is_active, listening)
  VALUES ('benchmark', 'http://127.0.0.1:9090', 'clash', 1, 1, 1)
`).run().lastInsertRowid);

const vendorIds = (db.prepare(`
  SELECT id FROM vendors WHERE slug <> 'unknown' ORDER BY id LIMIT ?
`).all(activeVendorsPerDevice) as Array<{ id: number }>).map((row) => row.id);
const insertVendorHour = db.prepare(`
  INSERT INTO vendor_hourly_stats
    (backend_id, hour, source_ip, vendor_id, upload, download, connections)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertVendorDay = db.prepare(`
  INSERT INTO vendor_daily_stats
    (backend_id, day, source_ip, vendor_id, upload, download, connections)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertVendorProtocolHour = db.prepare(`
  INSERT INTO vendor_protocol_hourly_stats
    (backend_id, hour, source_ip, vendor_id, transport, application_protocol, confidence, upload, download, connections)
  VALUES (?, ?, ?, ?, ?, ?, 'inferred', ?, ?, ?)
`);
const insertVendorProtocolDay = db.prepare(`
  INSERT INTO vendor_protocol_daily_stats
    (backend_id, day, source_ip, vendor_id, transport, application_protocol, confidence, upload, download, connections)
  VALUES (?, ?, ?, ?, ?, ?, 'inferred', ?, ?, ?)
`);
const insertVendorEndpointHour = db.prepare(`
  INSERT INTO vendor_endpoint_hourly_stats
    (backend_id, hour, source_ip, vendor_id, endpoint_type, endpoint,
     transport, application_protocol, confidence, upload, download, connections)
  VALUES (?, ?, ?, ?, 'domain', ?, ?, ?, 'exact', ?, ?, ?)
`);
const insertVendorEndpointDay = db.prepare(`
  INSERT INTO vendor_endpoint_daily_stats
    (backend_id, day, source_ip, vendor_id, endpoint_type, endpoint,
     transport, application_protocol, confidence, upload, download, connections)
  VALUES (?, ?, ?, ?, 'domain', ?, ?, ?, 'exact', ?, ?, ?)
`);
const insertObservabilityHour = db.prepare(`
  INSERT INTO traffic_observability_hourly_stats
    (backend_id, hour, source_ip, domain_present, upload, download, connections)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertObservabilityDay = db.prepare(`
  INSERT INTO traffic_observability_daily_stats
    (backend_id, day, source_ip, domain_present, upload, download, connections)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertUnresolvedDay = db.prepare(`
  INSERT INTO unresolved_domain_daily_stats
    (backend_id, day, source_ip, registrable_domain, upload, download, connections)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertMonitor = db.prepare(`
  INSERT INTO monitors (name, type, target, interval_seconds, timeout_ms)
  VALUES (?, 'tcp', '10.0.1.1', 60, 5000)
`);
const insertMonitorHour = db.prepare(`
  INSERT INTO monitor_hourly_stats
    (monitor_id, hour, checks, up_checks, down_checks, degraded_checks,
     latency_sum, latency_min, latency_max, last_status)
  VALUES (?, ?, 60, 60, 0, 0, 1200, 8, 50, 'up')
`);
const insertMonitorMinute = db.prepare(`
  INSERT INTO monitor_minute_stats
    (monitor_id, minute, checks, up_checks, down_checks, degraded_checks,
     latency_sum, latency_min, latency_max, last_status)
  VALUES (?, ?, 1, 1, 0, 0, 20, 20, 20, 'up')
`);

const now = new Date();
now.setUTCMinutes(0, 0, 0);
const startedAt = performance.now();
db.transaction(() => {
  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const dayDate = new Date(now.getTime() - dayOffset * 86_400_000);
    const day = dayDate.toISOString().slice(0, 10);
    for (let device = 0; device < devices; device++) {
      const sourceIP = `10.0.1.${40 + device}`;
      for (const vendorId of vendorIds) {
        insertVendorDay.run(backendId, day, sourceIP, vendorId, 50_000, 500_000, 120);
        for (let endpointIndex = 0; endpointIndex < endpointsPerVendor; endpointIndex++) {
          const isQuic = endpointIndex % 2 === 1;
          const endpoint = `edge-${vendorId}-${endpointIndex}.example`;
          insertVendorEndpointDay.run(
            backendId, day, sourceIP, vendorId, endpoint,
            isQuic ? 'udp' : 'tcp', isQuic ? 'quic' : 'tls',
            10_000, 100_000, 24,
          );
        }
        for (let protocolIndex = 0; protocolIndex < protocolsPerVendor; protocolIndex++) {
          const isQuic = protocolIndex % 2 === 1;
          insertVendorProtocolDay.run(
            backendId, day, sourceIP, vendorId,
            isQuic ? 'udp' : 'tcp', isQuic ? 'quic' : 'tls',
            25_000, 250_000, 60,
          );
        }
        for (let hour = 0; hour < 24; hour++) {
          const hourKey = `${day}T${String(hour).padStart(2, '0')}:00:00`;
          insertVendorHour.run(backendId, hourKey, sourceIP, vendorId, 2100, 21_000, 5);
          if (dayOffset < endpointHourlyRetentionDays) {
            for (let endpointIndex = 0; endpointIndex < endpointsPerVendor; endpointIndex++) {
              const isQuic = endpointIndex % 2 === 1;
              insertVendorEndpointHour.run(
                backendId, hourKey, sourceIP, vendorId,
                `edge-${vendorId}-${endpointIndex}.example`,
                isQuic ? 'udp' : 'tcp', isQuic ? 'quic' : 'tls',
                420, 4200, 1,
              );
            }
          }
          for (let protocolIndex = 0; protocolIndex < protocolsPerVendor; protocolIndex++) {
            const isQuic = protocolIndex % 2 === 1;
            insertVendorProtocolHour.run(
              backendId, hourKey, sourceIP, vendorId,
              isQuic ? 'udp' : 'tcp', isQuic ? 'quic' : 'tls',
              1050, 10_500, 3,
            );
          }
        }
      }
      for (let domainPresent = 0; domainPresent <= 1; domainPresent++) {
        insertObservabilityDay.run(backendId, day, sourceIP, domainPresent, 75_000, 750_000, 180);
        for (let hour = 0; hour < 24; hour++) {
          insertObservabilityHour.run(
            backendId,
            `${day}T${String(hour).padStart(2, '0')}:00:00`,
            sourceIP,
            domainPresent,
            3200,
            32_000,
            8,
          );
        }
      }
      for (let unresolvedIndex = 0; unresolvedIndex < unresolvedDomainsPerDevice; unresolvedIndex++) {
        insertUnresolvedDay.run(
          backendId,
          day,
          sourceIP,
          `unknown-${device}-${unresolvedIndex}.example`,
          5000,
          50_000,
          12,
        );
      }
    }
  }

  const monitorIds: number[] = [];
  for (let index = 0; index < monitors; index++) {
    monitorIds.push(Number(insertMonitor.run(`monitor-${index + 1}`).lastInsertRowid));
  }
  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const day = new Date(now.getTime() - dayOffset * 86_400_000).toISOString().slice(0, 10);
    for (const monitorId of monitorIds) {
      for (let hour = 0; hour < 24; hour++) {
        insertMonitorHour.run(monitorId, `${day}T${String(hour).padStart(2, '0')}:00:00`);
      }
    }
  }
  for (let minuteOffset = 0; minuteOffset < minuteRetentionDays * 1440; minuteOffset++) {
    const minute = new Date(now.getTime() - minuteOffset * 60_000).toISOString().slice(0, 16) + ':00';
    for (const monitorId of monitorIds) insertMonitorMinute.run(monitorId, minute);
  }
})();
db.pragma('wal_checkpoint(TRUNCATE)');

function timedQuery(sql: string, params: unknown[]): number {
  const started = performance.now();
  db.prepare(sql).all(...params);
  return Number((performance.now() - started).toFixed(2));
}

const startKey = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 13) + ':00:00';
const endKey = now.toISOString().slice(0, 13) + ':00:00';
const rowCounts = Object.fromEntries(
  [
    'vendor_hourly_stats',
    'vendor_daily_stats',
    'vendor_protocol_hourly_stats',
    'vendor_protocol_daily_stats',
    'vendor_endpoint_hourly_stats',
    'vendor_endpoint_daily_stats',
    'traffic_observability_hourly_stats',
    'traffic_observability_daily_stats',
    'unresolved_domain_daily_stats',
    'monitor_hourly_stats',
    'monitor_minute_stats',
  ].map((table) => [
    table,
    (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
  ]),
);
const result = {
  assumptions: {
    days, devices, activeVendorsPerDevice, protocolsPerVendor,
    endpointsPerVendor, endpointHourlyRetentionDays,
    unresolvedDomainsPerDevice, monitors, minuteRetentionDays,
  },
  rows: rowCounts,
  databaseBytes: statSync(dbPath).size,
  buildSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(2)),
  queryMs: {
    vendorTotals365d: timedQuery(`
      SELECT vendor_id, SUM(upload + download) AS traffic
      FROM vendor_hourly_stats
      WHERE backend_id = ? AND hour BETWEEN ? AND ?
      GROUP BY vendor_id ORDER BY traffic DESC
    `, [backendId, startKey, endKey]),
    vendorByDevice365d: timedQuery(`
      SELECT source_ip, vendor_id, SUM(upload + download) AS traffic
      FROM vendor_hourly_stats
      WHERE backend_id = ? AND hour BETWEEN ? AND ?
      GROUP BY source_ip, vendor_id ORDER BY traffic DESC LIMIT 500
    `, [backendId, startKey, endKey]),
    vendorProtocol365d: timedQuery(`
      SELECT vendor_id, transport, application_protocol, SUM(upload + download) AS traffic
      FROM vendor_protocol_hourly_stats
      WHERE backend_id = ? AND hour BETWEEN ? AND ?
      GROUP BY vendor_id, transport, application_protocol ORDER BY traffic DESC
    `, [backendId, startKey, endKey]),
    vendorEndpointTop10Daily365d: timedQuery(`
      SELECT endpoint_type, endpoint, SUM(upload + download) AS traffic
      FROM vendor_endpoint_daily_stats
      WHERE backend_id = ? AND vendor_id = ? AND day BETWEEN ? AND ?
      GROUP BY endpoint_type, endpoint ORDER BY traffic DESC LIMIT 10
    `, [backendId, vendorIds[0], startKey.slice(0, 10), endKey.slice(0, 10)]),
    monitorHistory365d: timedQuery(`
      SELECT hour, up_checks, down_checks, latency_sum
      FROM monitor_hourly_stats
      WHERE monitor_id = 1 AND hour BETWEEN ? AND ? ORDER BY hour
    `, [startKey, endKey]),
  },
};
console.info(JSON.stringify(result, null, 2));
db.close();
rmSync(directory, { recursive: true, force: true });
