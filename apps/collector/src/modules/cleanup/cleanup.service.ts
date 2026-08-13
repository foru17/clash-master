import { StatsDatabase } from '../db/db.js';
import { RetentionConfig, DEFAULT_RETENTION, type RetentionPeriod } from './cleanup.types.js';

export interface CleanupOverrides {
  cleanupInterval?: number;
  connectionLogsDays?: RetentionPeriod;
  hourlyStatsDays?: RetentionPeriod;
  healthLogDays?: RetentionPeriod;
  vendorHourlyDays?: RetentionPeriod;
  vendorEndpointHourlyDays?: RetentionPeriod;
  monitorMinuteDays?: RetentionPeriod;
  monitorHourlyDays?: RetentionPeriod;
  autoCleanup?: boolean;
}

/**
 * Automatic data cleanup service
 *
 * Implements tiered data retention:
 * - Minute-level stats: Short term (configurable, default 7 days)
 * - Hourly stats: Medium term (configurable, default 30 days)
 * - Backend health logs: Medium term (defaults to hourlyStatsDays, independently overridable)
 * - Daily/domain stats: Long term (permanent, continuously updated)
 */
export class CleanupService {
  private db: StatsDatabase;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private overrides: CleanupOverrides;

  constructor(db: StatsDatabase, overrides: CleanupOverrides = {}) {
    this.db = db;
    this.overrides = overrides;
  }

  /**
   * Get effective config by merging (in precedence order):
   * env/constructor overrides > DB config > defaults.
   */
  private getConfig(): RetentionConfig & { healthLogDays: RetentionPeriod } {
    const dbConfig = this.db.getRetentionConfig();
    const merged: RetentionConfig = {
      ...DEFAULT_RETENTION,
      ...dbConfig,
      cleanupInterval: this.overrides.cleanupInterval ?? DEFAULT_RETENTION.cleanupInterval,
    };
    if (this.overrides.connectionLogsDays !== undefined) merged.connectionLogsDays = this.overrides.connectionLogsDays;
    if (this.overrides.hourlyStatsDays !== undefined) merged.hourlyStatsDays = this.overrides.hourlyStatsDays;
    if (this.overrides.vendorHourlyDays !== undefined) merged.vendorHourlyDays = this.overrides.vendorHourlyDays;
    if (this.overrides.vendorEndpointHourlyDays !== undefined) merged.vendorEndpointHourlyDays = this.overrides.vendorEndpointHourlyDays;
    if (this.overrides.monitorMinuteDays !== undefined) merged.monitorMinuteDays = this.overrides.monitorMinuteDays;
    if (this.overrides.monitorHourlyDays !== undefined) merged.monitorHourlyDays = this.overrides.monitorHourlyDays;
    if (this.overrides.autoCleanup !== undefined) merged.autoCleanup = this.overrides.autoCleanup;
    return {
      ...merged,
      healthLogDays: this.overrides.healthLogDays ?? merged.hourlyStatsDays,
    };
  }

  /**
   * Start automatic cleanup scheduling.
   *
   * The timer is always scheduled so that toggling autoCleanup via the UI
   * takes effect on the next tick without needing to restart the service.
   * Each tick re-reads the config and short-circuits if autoCleanup is off.
   */
  start(): void {
    if (this.cleanupTimer) {
      return; // Already running
    }

    const config = this.getConfig();
    console.log(`[Cleanup] Starting with retention policy:`, {
      autoCleanup: config.autoCleanup,
      minuteStats: config.connectionLogsDays,
      hourlyStats: config.hourlyStatsDays,
      vendorHourlyStats: config.vendorHourlyDays,
      vendorEndpointHourlyStats: config.vendorEndpointHourlyDays,
      monitorMinuteStats: config.monitorMinuteDays,
      monitorHourlyStats: config.monitorHourlyDays,
      healthLogs: config.healthLogDays,
      interval: `${config.cleanupInterval} hours`,
    });

    // Run initial cleanup immediately so upgrading users see the effect at boot.
    this.runCleanup();

    const intervalMs = config.cleanupInterval * 60 * 60 * 1000;
    this.cleanupTimer = setInterval(() => {
      this.runCleanup();
    }, intervalMs);
  }

  /**
   * Stop automatic cleanup
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      console.log('[Cleanup] Stopped');
    }
  }

  /**
   * Run cleanup manually
   */
  async runCleanup(): Promise<void> {
    const config = this.getConfig();
    if (!config.autoCleanup) {
      return;
    }

    if (this.isRunning) {
      console.log('[Cleanup] Previous cleanup still running, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      // Clean up old minute-level stats
      const logsDeleted = this.cleanupConnectionLogs();

      // Clean up old hourly stats
      const hourlyDeleted = this.cleanupHourlyStats();
      const vendorDeleted = this.cleanupVendorStats();
      const monitorDeleted = this.cleanupMonitorStats();

      // Clean up old health logs (independently overridable, defaults to hourlyStatsDays)
      this.cleanupHealthLogs();

      // Vacuum database to reclaim space (only if significant data deleted)
      const totalDeleted = logsDeleted + hourlyDeleted + vendorDeleted + monitorDeleted;
      if (totalDeleted > 10000) {
        console.log(`[Cleanup] Deleted ${totalDeleted} records, vacuuming database...`);
        this.db.vacuum();
      }

      const duration = Date.now() - startTime;
      console.log(`[Cleanup] Completed in ${duration}ms: ${logsDeleted} minute, ${hourlyDeleted} detail-hourly, ${vendorDeleted} vendor-hourly, ${monitorDeleted} monitor records deleted`);
    } catch (err) {
      console.error('[Cleanup] Failed:', err);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Clean up old minute stats (replaced connection logs)
   */
  private cleanupConnectionLogs(): number {
    const config = this.getConfig();
    if (config.connectionLogsDays === 'forever') return 0;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.connectionLogsDays);
    const cutoff = cutoffDate.toISOString();

    return this.db.deleteOldMinuteStats(cutoff);
  }

  /**
   * Clean up old health logs (uses healthLogDays override, falling back to hourlyStatsDays)
   */
  private cleanupHealthLogs(): void {
    const config = this.getConfig();
    if (config.healthLogDays === 'forever') return;
    this.db.repos.health.pruneOldLogs(config.healthLogDays);
  }

  /**
   * Clean up old hourly stats
   */
  private cleanupHourlyStats(): number {
    const config = this.getConfig();
    if (config.hourlyStatsDays === 'forever') return 0;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.hourlyStatsDays);
    const cutoff = cutoffDate.toISOString().slice(0, 13) + ':00:00';

    return this.db.deleteOldHourlyStats(cutoff);
  }

  private cleanupVendorStats(): number {
    const config = this.getConfig();
    if (config.vendorHourlyDays === 'forever' && config.vendorEndpointHourlyDays === 'forever') return 0;
    const vendorDays = config.vendorHourlyDays === 'forever' ? null : config.vendorHourlyDays;
    const endpointDays = config.vendorEndpointHourlyDays === 'forever' ? null : config.vendorEndpointHourlyDays;
    let deleted = 0;
    if (vendorDays !== null) {
      const cutoff = new Date(Date.now() - vendorDays * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 13) + ':00:00';
      deleted += this.db.deleteOldVendorHourlyStats(cutoff);
    }
    if (endpointDays !== null) {
      const cutoff = new Date(Date.now() - endpointDays * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 13) + ':00:00';
      deleted += this.db.repos.vendor.deleteOldEndpointHourlyStats(cutoff);
    }
    return deleted;
  }

  private cleanupMonitorStats(): number {
    const config = this.getConfig();
    if (config.monitorMinuteDays === 'forever' && config.monitorHourlyDays === 'forever') return 0;
    const minuteCutoff = config.monitorMinuteDays === 'forever' ? null : new Date(Date.now() - config.monitorMinuteDays * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 16) + ':00';
    const hourlyCutoff = config.monitorHourlyDays === 'forever' ? null : new Date(Date.now() - config.monitorHourlyDays * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 13) + ':00:00';
    return this.db.deleteOldMonitorStats(minuteCutoff, hourlyCutoff);
  }

  /**
   * Get current database size statistics
   */
  getStats(): {
    connectionLogsCount: number;
    hourlyStatsCount: number;
    oldestConnectionLog: string | null;
    oldestHourlyStat: string | null;
  } {
    return this.db.getCleanupStats();
  }

  /**
   * Update retention configuration
   */
  updateConfig(config: Partial<RetentionConfig>): void {
    // Save to database
    this.db.updateRetentionConfig({
      connectionLogsDays: config.connectionLogsDays,
      hourlyStatsDays: config.hourlyStatsDays,
      vendorHourlyDays: config.vendorHourlyDays,
      vendorEndpointHourlyDays: config.vendorEndpointHourlyDays,
      monitorMinuteDays: config.monitorMinuteDays,
      monitorHourlyDays: config.monitorHourlyDays,
      autoCleanup: config.autoCleanup,
    });

    // Handle interval change
    if (config.cleanupInterval !== undefined) {
      this.overrides.cleanupInterval = config.cleanupInterval;
    }

    // Restart only when the tick interval changed — autoCleanup is re-evaluated
    // on every tick now, so toggling it doesn't require a restart.
    if (config.cleanupInterval !== undefined && this.cleanupTimer) {
      this.stop();
      this.start();
    }
  }
}
