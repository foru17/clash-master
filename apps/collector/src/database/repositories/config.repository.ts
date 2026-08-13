/**
 * Config Repository
 *
 * Handles database maintenance: retention configuration, data cleanup,
 * vacuum, and statistics about stored data.
 */
import type Database from 'better-sqlite3';
import * as fs from 'node:fs';
import path from 'node:path';
import { BaseRepository } from './base.repository.js';

type RetentionPeriod = number | 'forever';

interface DatabaseRetentionConfig {
  connectionLogsDays: RetentionPeriod;
  hourlyStatsDays: RetentionPeriod;
  vendorHourlyDays: RetentionPeriod;
  vendorEndpointHourlyDays: RetentionPeriod;
  monitorMinuteDays: RetentionPeriod;
  monitorHourlyDays: RetentionPeriod;
  autoCleanup: boolean;
}

export type GeoLookupProvider = 'online' | 'local';

export interface GeoLookupConfig {
  provider: GeoLookupProvider;
  mmdbDir: string;
  onlineApiUrl: string;
  localMmdbReady: boolean;
  missingMmdbFiles: string[];
}

export class ConfigRepository extends BaseRepository {
  private dbPath: string;
  private mmdbStatusCache:
    | {
      dir: string;
      checkedAt: number;
      missingMmdbFiles: string[];
    }
    | null = null;
  public static readonly REQUIRED_MMDB_FILES = [
    'GeoLite2-City.mmdb',
    'GeoLite2-ASN.mmdb',
  ] as const;
  private static readonly DEFAULT_MMDB_DIR = '/app/data/geoip';
  private static readonly MMDB_STATUS_CACHE_TTL_MS = 5000;

  constructor(db: Database.Database, dbPath: string) {
    super(db);
    this.dbPath = dbPath;
  }

  // Retention config
  getRetentionConfig(): DatabaseRetentionConfig {
    const connectionLogsDays = this.db.prepare(
      `SELECT value FROM app_config WHERE key = 'retention.connection_logs_days'`,
    ).get() as { value: string } | undefined;

    const hourlyStatsDays = this.db.prepare(
      `SELECT value FROM app_config WHERE key = 'retention.hourly_stats_days'`,
    ).get() as { value: string } | undefined;

    const autoCleanup = this.db.prepare(
      `SELECT value FROM app_config WHERE key = 'retention.auto_cleanup'`,
    ).get() as { value: string } | undefined;

    const vendorHourlyDays = this.getRetentionPeriod('retention.vendor_hourly_days', 365);
    const vendorEndpointHourlyDays = this.getRetentionPeriod('retention.vendor_endpoint_hourly_days', 90);
    const monitorMinuteDays = this.getRetentionPeriod('retention.monitor_minute_days', 30);
    const monitorHourlyDays = this.getRetentionPeriod('retention.monitor_hourly_days', 365);

    return {
      connectionLogsDays: this.parseRetentionValue(connectionLogsDays?.value, 7),
      hourlyStatsDays: this.parseRetentionValue(hourlyStatsDays?.value, 30),
      vendorHourlyDays,
      vendorEndpointHourlyDays,
      monitorMinuteDays,
      monitorHourlyDays,
      // Default ON when no row exists; an explicit '0' disables it.
      autoCleanup: autoCleanup ? autoCleanup.value !== '0' : true,
    };
  }

  updateRetentionConfig(updates: {
    connectionLogsDays?: RetentionPeriod;
    hourlyStatsDays?: RetentionPeriod;
    vendorHourlyDays?: RetentionPeriod;
    vendorEndpointHourlyDays?: RetentionPeriod;
    monitorMinuteDays?: RetentionPeriod;
    monitorHourlyDays?: RetentionPeriod;
    autoCleanup?: boolean;
  }): DatabaseRetentionConfig {
    if (updates.connectionLogsDays !== undefined) {
      this.db.prepare(`
        INSERT INTO app_config (key, value) VALUES ('retention.connection_logs_days', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(updates.connectionLogsDays.toString());
    }
    if (updates.hourlyStatsDays !== undefined) {
      this.db.prepare(`
        INSERT INTO app_config (key, value) VALUES ('retention.hourly_stats_days', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(updates.hourlyStatsDays.toString());
    }
    this.setRetentionPeriod('retention.vendor_hourly_days', updates.vendorHourlyDays);
    this.setRetentionPeriod('retention.vendor_endpoint_hourly_days', updates.vendorEndpointHourlyDays);
    this.setRetentionPeriod('retention.monitor_minute_days', updates.monitorMinuteDays);
    this.setRetentionPeriod('retention.monitor_hourly_days', updates.monitorHourlyDays);
    if (updates.autoCleanup !== undefined) {
      this.db.prepare(`
        INSERT INTO app_config (key, value) VALUES ('retention.auto_cleanup', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(updates.autoCleanup ? '1' : '0');
    }
    return this.getRetentionConfig();
  }

  private parseRetentionValue(value: string | undefined, fallback: number): RetentionPeriod {
    if (value === 'forever') return 'forever';
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private getRetentionPeriod(key: string, fallback: number): RetentionPeriod {
    const row = this.db.prepare(`SELECT value FROM app_config WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return this.parseRetentionValue(row?.value, fallback);
  }

  private setRetentionPeriod(key: string, value: RetentionPeriod | undefined): void {
    if (value === undefined) return;
    this.db.prepare(`
      INSERT INTO app_config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, value.toString());
  }

  // Geo lookup config
  getGeoLookupConfig(): GeoLookupConfig {
    const providerRow = this.db.prepare(
      `SELECT value FROM app_config WHERE key = 'geoip.lookup_provider'`,
    ).get() as { value: string } | undefined;

    const onlineApiUrlRow = this.db.prepare(
      `SELECT value FROM app_config WHERE key = 'geoip.online_api_url'`,
    ).get() as { value: string } | undefined;

    const envProviderRaw = process.env.GEOIP_LOOKUP_PROVIDER?.trim();
    const envProvider =
      envProviderRaw === 'online' || envProviderRaw === 'local'
        ? envProviderRaw
        : undefined;
    const providerValue =
      envProvider ||
      (providerRow?.value === 'online' || providerRow?.value === 'local'
        ? (providerRow.value as GeoLookupProvider)
        : 'online');

    const mmdbDirValue = this.resolveMmdbDir();
    const missingMmdbFiles = this.getMissingMmdbFiles(mmdbDirValue);

    return {
      provider: providerValue,
      mmdbDir: mmdbDirValue,
      onlineApiUrl:
        process.env.GEOIP_ONLINE_API_URL?.trim() ||
        onlineApiUrlRow?.value ||
        'https://api.ipinfo.es/ipinfo',
      localMmdbReady: missingMmdbFiles.length === 0,
      missingMmdbFiles,
    };
  }

  private getMissingMmdbFiles(mmdbDir: string): string[] {
    const now = Date.now();
    const cached = this.mmdbStatusCache;
    if (
      cached &&
      cached.dir === mmdbDir &&
      now - cached.checkedAt < ConfigRepository.MMDB_STATUS_CACHE_TTL_MS
    ) {
      return cached.missingMmdbFiles;
    }

    const missingMmdbFiles = ConfigRepository.REQUIRED_MMDB_FILES.filter(
      (file) => !fs.existsSync(path.join(mmdbDir, file)),
    );

    this.mmdbStatusCache = {
      dir: mmdbDir,
      checkedAt: now,
      missingMmdbFiles,
    };

    return missingMmdbFiles;
  }

  private resolveMmdbDir(): string {
    const envMmdbDir = process.env.GEOIP_MMDB_DIR?.trim();
    const fallbackCandidates = [
      path.join(process.cwd(), 'geoip'),
      path.join(process.cwd(), 'geo'),
      path.resolve(process.cwd(), '..', 'geoip'),
      path.resolve(process.cwd(), '..', 'geo'),
      path.resolve(process.cwd(), '..', '..', 'geoip'),
      path.resolve(process.cwd(), '..', '..', 'geo'),
      ConfigRepository.DEFAULT_MMDB_DIR,
    ];

    const candidates = [envMmdbDir, ...fallbackCandidates]
      .filter((dir): dir is string => !!dir)
      .map((dir) => path.resolve(dir));
    const uniqueCandidates = Array.from(new Set(candidates));
    const existing = uniqueCandidates.find((dir) => fs.existsSync(dir));
    if (existing) return existing;

    if (envMmdbDir) {
      return path.resolve(envMmdbDir);
    }
    return ConfigRepository.DEFAULT_MMDB_DIR;
  }

  updateGeoLookupConfig(updates: {
    provider?: GeoLookupProvider;
    onlineApiUrl?: string;
  }): GeoLookupConfig {
    if (updates.provider !== undefined) {
      this.db.prepare(`
        INSERT INTO app_config (key, value) VALUES ('geoip.lookup_provider', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(updates.provider);
    }
    if (updates.onlineApiUrl !== undefined) {
      this.db.prepare(`
        INSERT INTO app_config (key, value) VALUES ('geoip.online_api_url', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(updates.onlineApiUrl);
    }

    return this.getGeoLookupConfig();
  }

  // Data cleanup
  cleanupOldData(backendId: number | null, days: number): {
    deletedConnections: number; deletedLogs: number; deletedDomains: number;
    deletedIPs: number; deletedProxies: number; deletedRules: number;
  } {
    let deletedConnections: number;
    let deletedLogs: number;
    let deletedDomains = 0;
    let deletedIPs = 0;
    let deletedProxies = 0;
    let deletedRules = 0;

    if (backendId !== null) {
      if (days === 0) {
        const minuteResult = this.db.prepare(`DELETE FROM minute_stats WHERE backend_id = ?`).run(backendId);
        deletedConnections = minuteResult.changes;
        deletedLogs = minuteResult.changes;
        this.db.prepare(`DELETE FROM minute_dim_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM minute_country_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM hourly_dim_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM hourly_country_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM connection_logs WHERE backend_id = ?`).run(backendId);

        deletedDomains = this.db.prepare(`DELETE FROM domain_stats WHERE backend_id = ?`).run(backendId).changes;
        deletedIPs = this.db.prepare(`DELETE FROM ip_stats WHERE backend_id = ?`).run(backendId).changes;
        deletedProxies = this.db.prepare(`DELETE FROM proxy_stats WHERE backend_id = ?`).run(backendId).changes;
        deletedRules = this.db.prepare(`DELETE FROM rule_stats WHERE backend_id = ?`).run(backendId).changes;

        this.db.prepare(`DELETE FROM country_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM rule_proxy_map WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM rule_chain_traffic WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM rule_domain_traffic WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM rule_ip_traffic WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM domain_proxy_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM ip_proxy_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM device_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM device_domain_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM device_ip_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM hourly_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM backend_health_logs WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM vendor_hourly_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM vendor_daily_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM vendor_protocol_hourly_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM vendor_protocol_daily_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM vendor_endpoint_hourly_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM vendor_endpoint_daily_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM traffic_observability_hourly_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM traffic_observability_daily_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM unresolved_domain_daily_stats WHERE backend_id = ?`).run(backendId);
      } else {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const minuteCutoff = cutoff.toISOString().slice(0, 16) + ':00';
        const hourCutoff = cutoff.toISOString().slice(0, 13) + ':00:00';
        const dayCutoff = cutoff.toISOString().slice(0, 10);
        const healthCutoff = cutoff.toISOString().slice(0, 16);
        const minuteResult = this.db.prepare(`DELETE FROM minute_stats WHERE backend_id = ? AND minute < ?`).run(backendId, minuteCutoff);
        deletedConnections = minuteResult.changes;
        deletedLogs = minuteResult.changes;
        this.db.prepare(`DELETE FROM minute_dim_stats WHERE backend_id = ? AND minute < ?`).run(backendId, minuteCutoff);
        this.db.prepare(`DELETE FROM minute_country_stats WHERE backend_id = ? AND minute < ?`).run(backendId, minuteCutoff);
        this.db.prepare(`DELETE FROM hourly_dim_stats WHERE backend_id = ? AND hour < ?`).run(backendId, hourCutoff);
        this.db.prepare(`DELETE FROM hourly_country_stats WHERE backend_id = ? AND hour < ?`).run(backendId, hourCutoff);
        this.db.prepare(`DELETE FROM connection_logs WHERE backend_id = ? AND timestamp < ?`).run(backendId, cutoff.toISOString());
        this.db.prepare(`DELETE FROM backend_health_logs WHERE backend_id = ? AND minute < ?`).run(backendId, healthCutoff);
        this.db.prepare(`DELETE FROM vendor_hourly_stats WHERE backend_id = ? AND hour < ?`).run(backendId, hourCutoff);
        this.db.prepare(`DELETE FROM vendor_daily_stats WHERE backend_id = ? AND day < ?`).run(backendId, dayCutoff);
        this.db.prepare(`DELETE FROM vendor_protocol_hourly_stats WHERE backend_id = ? AND hour < ?`).run(backendId, hourCutoff);
        this.db.prepare(`DELETE FROM vendor_protocol_daily_stats WHERE backend_id = ? AND day < ?`).run(backendId, dayCutoff);
        this.db.prepare(`DELETE FROM vendor_endpoint_hourly_stats WHERE backend_id = ? AND hour < ?`).run(backendId, hourCutoff);
        this.db.prepare(`DELETE FROM vendor_endpoint_daily_stats WHERE backend_id = ? AND day < ?`).run(backendId, dayCutoff);
        this.db.prepare(`DELETE FROM traffic_observability_hourly_stats WHERE backend_id = ? AND hour < ?`).run(backendId, hourCutoff);
        this.db.prepare(`DELETE FROM traffic_observability_daily_stats WHERE backend_id = ? AND day < ?`).run(backendId, dayCutoff);
        this.db.prepare(`DELETE FROM unresolved_domain_daily_stats WHERE backend_id = ? AND day < ?`).run(backendId, dayCutoff);
      }
    } else {
      if (days === 0) {
        const minuteResult = this.db.prepare(`DELETE FROM minute_stats`).run();
        deletedConnections = minuteResult.changes;
        deletedLogs = minuteResult.changes;
        this.db.prepare(`DELETE FROM minute_dim_stats`).run();
        this.db.prepare(`DELETE FROM minute_country_stats`).run();
        this.db.prepare(`DELETE FROM hourly_dim_stats`).run();
        this.db.prepare(`DELETE FROM hourly_country_stats`).run();
        this.db.prepare(`DELETE FROM connection_logs`).run();

        deletedDomains = this.db.prepare(`DELETE FROM domain_stats`).run().changes;
        deletedIPs = this.db.prepare(`DELETE FROM ip_stats`).run().changes;
        deletedProxies = this.db.prepare(`DELETE FROM proxy_stats`).run().changes;
        deletedRules = this.db.prepare(`DELETE FROM rule_stats`).run().changes;

        this.db.prepare(`DELETE FROM country_stats`).run();
        this.db.prepare(`DELETE FROM rule_proxy_map`).run();
        this.db.prepare(`DELETE FROM rule_chain_traffic`).run();
        this.db.prepare(`DELETE FROM rule_domain_traffic`).run();
        this.db.prepare(`DELETE FROM rule_ip_traffic`).run();
        this.db.prepare(`DELETE FROM domain_proxy_stats`).run();
        this.db.prepare(`DELETE FROM ip_proxy_stats`).run();
        this.db.prepare(`DELETE FROM device_stats`).run();
        this.db.prepare(`DELETE FROM device_domain_stats`).run();
        this.db.prepare(`DELETE FROM device_ip_stats`).run();
        this.db.prepare(`DELETE FROM hourly_stats`).run();
        this.db.prepare(`DELETE FROM backend_health_logs`).run();
        this.db.prepare(`DELETE FROM vendor_hourly_stats`).run();
        this.db.prepare(`DELETE FROM vendor_daily_stats`).run();
        this.db.prepare(`DELETE FROM vendor_protocol_hourly_stats`).run();
        this.db.prepare(`DELETE FROM vendor_protocol_daily_stats`).run();
        this.db.prepare(`DELETE FROM vendor_endpoint_hourly_stats`).run();
        this.db.prepare(`DELETE FROM vendor_endpoint_daily_stats`).run();
        this.db.prepare(`DELETE FROM traffic_observability_hourly_stats`).run();
        this.db.prepare(`DELETE FROM traffic_observability_daily_stats`).run();
        this.db.prepare(`DELETE FROM unresolved_domain_daily_stats`).run();
        this.db.prepare(`DELETE FROM monitor_minute_stats`).run();
        this.db.prepare(`DELETE FROM monitor_hourly_stats`).run();
        this.db.prepare(`DELETE FROM monitor_incidents`).run();
      } else {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const minuteCutoff = cutoff.toISOString().slice(0, 16) + ':00';
        const hourCutoff = cutoff.toISOString().slice(0, 13) + ':00:00';
        const dayCutoff = cutoff.toISOString().slice(0, 10);
        const healthCutoff = cutoff.toISOString().slice(0, 16);
        const minuteResult = this.db.prepare(`DELETE FROM minute_stats WHERE minute < ?`).run(minuteCutoff);
        deletedConnections = minuteResult.changes;
        deletedLogs = minuteResult.changes;
        this.db.prepare(`DELETE FROM minute_dim_stats WHERE minute < ?`).run(minuteCutoff);
        this.db.prepare(`DELETE FROM minute_country_stats WHERE minute < ?`).run(minuteCutoff);
        this.db.prepare(`DELETE FROM hourly_dim_stats WHERE hour < ?`).run(hourCutoff);
        this.db.prepare(`DELETE FROM hourly_country_stats WHERE hour < ?`).run(hourCutoff);
        this.db.prepare(`DELETE FROM connection_logs WHERE timestamp < ?`).run(cutoff.toISOString());
        this.db.prepare(`DELETE FROM backend_health_logs WHERE minute < ?`).run(healthCutoff);
        this.db.prepare(`DELETE FROM vendor_hourly_stats WHERE hour < ?`).run(hourCutoff);
        this.db.prepare(`DELETE FROM vendor_daily_stats WHERE day < ?`).run(dayCutoff);
        this.db.prepare(`DELETE FROM vendor_protocol_hourly_stats WHERE hour < ?`).run(hourCutoff);
        this.db.prepare(`DELETE FROM vendor_protocol_daily_stats WHERE day < ?`).run(dayCutoff);
        this.db.prepare(`DELETE FROM vendor_endpoint_hourly_stats WHERE hour < ?`).run(hourCutoff);
        this.db.prepare(`DELETE FROM vendor_endpoint_daily_stats WHERE day < ?`).run(dayCutoff);
        this.db.prepare(`DELETE FROM traffic_observability_hourly_stats WHERE hour < ?`).run(hourCutoff);
        this.db.prepare(`DELETE FROM traffic_observability_daily_stats WHERE day < ?`).run(dayCutoff);
        this.db.prepare(`DELETE FROM unresolved_domain_daily_stats WHERE day < ?`).run(dayCutoff);
        this.db.prepare(`DELETE FROM monitor_minute_stats WHERE minute < ?`).run(minuteCutoff);
        this.db.prepare(`DELETE FROM monitor_hourly_stats WHERE hour < ?`).run(hourCutoff);
        this.db.prepare(`
          DELETE FROM monitor_incidents
          WHERE status = 'resolved' AND COALESCE(ended_at, started_at) < ?
        `).run(cutoff.toISOString());
      }
    }

    if (days === 0) {
      this.vacuum();
    }

    return { deletedConnections, deletedLogs, deletedDomains, deletedIPs, deletedProxies, deletedRules };
  }

  cleanupASNCache(days: number): number {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    return this.db.prepare(`DELETE FROM asn_cache WHERE queried_at < ?`).run(cutoff).changes;
  }

  getDatabaseSize(): number {
    try {
      return fs.statSync(this.dbPath).size;
    } catch {
      return 0;
    }
  }

  getConnectionLogsCount(backendId: number): number {
    return (this.db.prepare(`SELECT COUNT(*) as count FROM minute_stats WHERE backend_id = ?`).get(backendId) as { count: number }).count;
  }

  getTotalConnectionLogsCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) as count FROM minute_stats`).get() as { count: number }).count;
  }

  vacuum(): void {
    this.db.exec('VACUUM');
  }

  deleteOldMinuteStats(cutoff: string): number {
    const minuteCutoff = cutoff.slice(0, 16) + ':00';
    this.db.prepare(`DELETE FROM minute_dim_stats WHERE minute < ?`).run(minuteCutoff);
    this.db.prepare(`DELETE FROM minute_country_stats WHERE minute < ?`).run(minuteCutoff);
    this.db.prepare(`DELETE FROM connection_logs WHERE timestamp < ?`).run(cutoff);
    return this.db.prepare(`DELETE FROM minute_stats WHERE minute < ?`).run(minuteCutoff).changes;
  }

  deleteOldConnectionLogs(cutoff: string): number {
    return this.deleteOldMinuteStats(cutoff);
  }

  deleteOldHourlyStats(cutoff: string): number {
    // hourly_dim/hourly_country back all >6h range queries (resolveFactTable),
    // so they must follow the hourly retention window, not the minute one.
    this.db.prepare(`DELETE FROM hourly_dim_stats WHERE hour < ?`).run(cutoff);
    this.db.prepare(`DELETE FROM hourly_country_stats WHERE hour < ?`).run(cutoff);
    return this.db.prepare(`DELETE FROM hourly_stats WHERE hour < ?`).run(cutoff).changes;
  }

  deleteOldVendorHourlyStats(cutoff: string): number {
    const cutoffDay = cutoff.slice(0, 10);
    const remove = this.db.transaction(() => {
      let changes = 0;
      changes += this.db.prepare(`DELETE FROM vendor_hourly_stats WHERE hour < ?`).run(cutoff).changes;
      changes += this.db.prepare(`DELETE FROM vendor_protocol_hourly_stats WHERE hour < ?`).run(cutoff).changes;
      changes += this.db.prepare(`DELETE FROM traffic_observability_hourly_stats WHERE hour < ?`).run(cutoff).changes;
      changes += this.db.prepare(`DELETE FROM unresolved_domain_daily_stats WHERE day < ?`).run(cutoffDay).changes;
      return changes;
    });
    return remove();
  }

  deleteOldMonitorStats(minuteCutoff: string | null, hourlyCutoff: string | null): number {
    const minute = minuteCutoff
      ? this.db.prepare(`DELETE FROM monitor_minute_stats WHERE minute < ?`).run(minuteCutoff).changes
      : 0;
    const hourly = hourlyCutoff
      ? this.db.prepare(`DELETE FROM monitor_hourly_stats WHERE hour < ?`).run(hourlyCutoff).changes
      : 0;
    return minute + hourly;
  }

  getCleanupStats(): {
    connectionLogsCount: number; hourlyStatsCount: number;
    oldestConnectionLog: string | null; oldestHourlyStat: string | null;
  } {
    return {
      connectionLogsCount: (this.db.prepare('SELECT COUNT(*) as count FROM minute_stats').get() as { count: number }).count,
      hourlyStatsCount: (this.db.prepare('SELECT COUNT(*) as count FROM hourly_stats').get() as { count: number }).count,
      oldestConnectionLog: (this.db.prepare('SELECT MIN(minute) as ts FROM minute_stats').get() as { ts: string | null })?.ts || null,
      oldestHourlyStat: (this.db.prepare('SELECT MIN(hour) as hr FROM hourly_stats').get() as { hr: string | null })?.hr || null,
    };
  }
}
