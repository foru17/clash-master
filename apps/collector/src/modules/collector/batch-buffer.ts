/**
 * Shared Batch Buffer
 *
 * Extracts the common BatchBuffer class, TrafficUpdate / GeoIPResult interfaces,
 * and toMinuteKey helper used by both collector.ts and surge-collector.ts.
 */
import type { StatsDatabase } from "../db/db.js";
import type { GeoIPService } from "../geo/geo.service.js";
import {
  getClickHouseWriter,
  type TrafficWriteOutcome,
} from "../clickhouse/clickhouse.writer.js";
import { buildRuleName } from "../../shared/utils/rule-name.js";
import { shouldSkipSqliteStatsWrites, shouldReduceSqliteWrites } from "../stats/stats-write-mode.js";

export interface TrafficUpdate {
  domain: string;
  ip: string;
  chain: string;
  chains: string[];
  rule: string;
  rulePayload: string;
  upload: number;
  download: number;
  connections?: number;
  sourceIP?: string;
  timestampMs?: number;
  network?: string;
  destinationPort?: string | number;
}

export interface GeoIPResult {
  ip: string;
  geo: {
    country: string;
    country_name: string;
    continent: string;
  } | null;
  upload: number;
  download: number;
  connections?: number;
  timestampMs?: number;
}

function normalizeConnections(value: number | undefined): number {
  const safe =
    typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.max(0, Math.floor(safe));
}

export function toMinuteKey(timestampMs?: number): string {
  const date = new Date(timestampMs ?? Date.now()).toISOString();
  return `${date.slice(0, 16)}:00`;
}

export interface CountryUpdate {
  country: string;
  countryName: string;
  continent: string;
  upload: number;
  download: number;
  connections: number;
  timestampMs?: number;
}

export interface FlushResult {
  domains: number;
  rules: number;
  trafficOk: boolean;
  countryOk: boolean;
  hasTrafficUpdates: boolean;
  hasCountryUpdates: boolean;
  hasUpdates: boolean;
  /** Pending traffic write, including detail+agg table status */
  pendingTrafficWrite?: Promise<TrafficWriteOutcome>;
  /** Pending country write */
  pendingCountryWrite?: Promise<void>;
  /**
   * Whether SQLite stats writes were skipped this flush because ClickHouse
   * was considered healthy. When true and the ClickHouse write later fails,
   * the caller must persist `updates`/`countryUpdates` to SQLite as a durable
   * fallback to avoid silent data loss.
   */
  sqliteSkipped: boolean;
  /** Snapshot of the traffic updates flushed this round (for fallback) */
  updates: TrafficUpdate[];
  /** Snapshot of the country updates flushed this round (for fallback) */
  countryUpdates: CountryUpdate[];
}

export class BatchBuffer {
  private buffer: Map<string, TrafficUpdate> = new Map();
  private geoQueue: GeoIPResult[] = [];
  private lastLogTime = 0;
  private logCounter = 0;

  add(backendId: number, update: TrafficUpdate) {
    const minuteKey = toMinuteKey(update.timestampMs);
    const fullChain = update.chains.join(" > ");
    const key = [
      backendId,
      minuteKey,
      update.domain,
      update.ip,
      update.chain,
      fullChain,
      update.rule,
      update.rulePayload,
      update.sourceIP || "",
      update.network || "",
      String(update.destinationPort || ""),
    ].join(":");
    const existing = this.buffer.get(key);
    const connections = normalizeConnections(update.connections);

    if (existing) {
      existing.upload += update.upload;
      existing.download += update.download;
      existing.connections =
        normalizeConnections(existing.connections) + connections;
      if ((update.timestampMs ?? 0) > (existing.timestampMs ?? 0)) {
        existing.timestampMs = update.timestampMs;
      }
    } else {
      this.buffer.set(key, { ...update, connections });
    }
  }

  addGeoResult(result: GeoIPResult) {
    this.geoQueue.push(result);
  }

  size(): number {
    return this.buffer.size;
  }

  hasPending(): boolean {
    return this.buffer.size > 0 || this.geoQueue.length > 0;
  }

  clear(): void {
    this.buffer.clear();
    this.geoQueue = [];
  }

  flush(
    db: StatsDatabase,
    _geoService: GeoIPService | undefined,
    backendId: number,
    logPrefix = "Collector",
  ): FlushResult {
    const clickHouseWriter = getClickHouseWriter();
    const skipSqliteStatsWrites = shouldSkipSqliteStatsWrites(
      clickHouseWriter.isHealthy(),
    );
    const updates = Array.from(this.buffer.values());
    const geoResults = [...this.geoQueue];

    // Calculate unique domains and rules for logging
    const domains = new Set<string>();
    const rules = new Set<string>();

    for (const update of updates) {
      if (update.domain) domains.add(update.domain);
      rules.add(buildRuleName(update) || "DIRECT");
    }

    let trafficOk = true;
    let countryOk = true;
    const hasTrafficUpdates = updates.length > 0;
    let hasCountryUpdates = false;
    let countryUpdates: CountryUpdate[] = [];
    let pendingTrafficWrite: Promise<TrafficWriteOutcome> | undefined;
    let pendingCountryWrite: Promise<void> | undefined;

    if (hasTrafficUpdates) {
      try {
        const reduceSQLiteWrites = shouldReduceSqliteWrites(clickHouseWriter.isHealthy());
        if (!skipSqliteStatsWrites) {
          db.batchUpdateTrafficStats(backendId, updates, reduceSQLiteWrites);
        }
        if (clickHouseWriter.isEnabled()) {
          pendingTrafficWrite = clickHouseWriter.writeTrafficBatch(
            backendId,
            updates,
          );
        }
      } catch (err) {
        trafficOk = false;
        console.error(`[${logPrefix}:${backendId}] Batch write failed:`, err);
      }
    }

    if (trafficOk) {
      this.buffer.clear();
    }

    if (geoResults.length > 0) {
      try {
        countryUpdates = geoResults
          .filter(
            (r): r is GeoIPResult & { geo: NonNullable<GeoIPResult["geo"]> } =>
              r.geo !== null,
          )
          .map((r) => ({
            country: r.geo.country || 'Unknown',
            countryName: r.geo.country_name || r.geo.country || 'Unknown',
            continent: r.geo.continent || 'Unknown',
            upload: r.upload,
            download: r.download,
            connections: Math.max(0, Math.floor(r.connections ?? 1)),
            timestampMs: r.timestampMs,
          }));
        hasCountryUpdates = countryUpdates.length > 0;
        if (hasCountryUpdates) {
          if (!skipSqliteStatsWrites) {
            db.batchUpdateCountryStats(backendId, countryUpdates);
          }
          if (clickHouseWriter.isEnabled()) {
            pendingCountryWrite = clickHouseWriter.writeCountryBatch(
              backendId,
              countryUpdates,
            );
          }
        }
      } catch (err) {
        countryOk = false;
        console.error(
          `[${logPrefix}:${backendId}] Country batch write failed:`,
          err,
        );
      }
    }

    if (countryOk) {
      this.geoQueue = [];
    }

    return {
      domains: domains.size,
      rules: rules.size,
      trafficOk,
      countryOk,
      hasTrafficUpdates,
      hasCountryUpdates,
      hasUpdates: hasTrafficUpdates || hasCountryUpdates,
      pendingTrafficWrite,
      pendingCountryWrite,
      sqliteSkipped: skipSqliteStatsWrites,
      updates,
      countryUpdates,
    };
  }

  shouldLog(): boolean {
    const now = Date.now();
    if (now - this.lastLogTime > 10000) {
      this.lastLogTime = now;
      return true;
    }
    return false;
  }

  incrementLogCounter(): number {
    return ++this.logCounter;
  }
}
