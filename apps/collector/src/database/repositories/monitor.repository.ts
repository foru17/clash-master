import type Database from 'better-sqlite3';
import type {
  AvailabilityMonitor,
  MonitorHistoryPoint,
  MonitorIncident,
  MonitorOverviewItem,
  MonitorStatus,
  MonitorType,
} from '@neko-master/shared';
import { BaseRepository } from './base.repository.js';

export interface MonitorInput {
  name: string;
  type: MonitorType;
  target: string;
  port?: number | null;
  httpMethod?: string;
  expectedStatusMin?: number;
  expectedStatusMax?: number;
  dnsServer?: string | null;
  dnsRecordType?: string;
  dnsExpected?: string | null;
  intervalSeconds?: number;
  timeoutMs?: number;
  failureThreshold?: number;
  recoveryThreshold?: number;
  latencyWarningMs?: number | null;
  enabled?: boolean;
}

export interface MonitorCheckResult {
  status: 'up' | 'down' | 'degraded';
  latencyMs: number | null;
  message: string;
  checkedAt: string;
}

export interface MonitorTransition {
  monitor: AvailabilityMonitor;
  previousStatus: MonitorStatus;
  currentStatus: MonitorStatus;
  changed: boolean;
}

type MonitorRow = {
  id: number;
  name: string;
  type: MonitorType;
  target: string;
  port: number | null;
  http_method: string;
  expected_status_min: number;
  expected_status_max: number;
  dns_server: string | null;
  dns_record_type: string;
  dns_expected: string | null;
  interval_seconds: number;
  timeout_ms: number;
  failure_threshold: number;
  recovery_threshold: number;
  latency_warning_ms: number | null;
  enabled: number;
  status: MonitorStatus | null;
  consecutive_failures: number | null;
  consecutive_successes: number | null;
  last_checked_at: string | null;
  last_up_at: string | null;
  last_down_at: string | null;
  latency_ms: number | null;
  message: string | null;
};

function mapMonitor(row: MonitorRow): AvailabilityMonitor {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    target: row.target,
    port: row.port,
    httpMethod: row.http_method,
    expectedStatusMin: row.expected_status_min,
    expectedStatusMax: row.expected_status_max,
    dnsServer: row.dns_server,
    dnsRecordType: row.dns_record_type,
    dnsExpected: row.dns_expected,
    intervalSeconds: row.interval_seconds,
    timeoutMs: row.timeout_ms,
    failureThreshold: row.failure_threshold,
    recoveryThreshold: row.recovery_threshold,
    latencyWarningMs: row.latency_warning_ms,
    enabled: row.enabled === 1,
    status: row.enabled === 1 ? (row.status ?? 'pending') : 'paused',
    lastCheckedAt: row.last_checked_at,
    lastUpAt: row.last_up_at,
    lastDownAt: row.last_down_at,
    latencyMs: row.latency_ms,
    message: row.message,
  };
}

const MONITOR_SELECT = `
  SELECT m.*, s.status, s.consecutive_failures, s.consecutive_successes,
         s.last_checked_at, s.last_up_at, s.last_down_at, s.latency_ms, s.message
  FROM monitors m
  LEFT JOIN monitor_states s ON s.monitor_id = m.id
`;

export class MonitorRepository extends BaseRepository {
  constructor(db: Database.Database) {
    super(db);
  }

  getMonitors(): AvailabilityMonitor[] {
    return (this.db.prepare(`${MONITOR_SELECT} ORDER BY m.name ASC`).all() as MonitorRow[])
      .map(mapMonitor);
  }

  getMonitor(id: number): AvailabilityMonitor | undefined {
    const row = this.db.prepare(`${MONITOR_SELECT} WHERE m.id = ?`).get(id) as
      | MonitorRow
      | undefined;
    return row ? mapMonitor(row) : undefined;
  }

  getDueMonitors(limit = 20): AvailabilityMonitor[] {
    return (this.db.prepare(`
      ${MONITOR_SELECT}
      WHERE m.enabled = 1
        AND (
          s.last_checked_at IS NULL
          OR datetime(s.last_checked_at, '+' || m.interval_seconds || ' seconds') <= datetime('now')
        )
      ORDER BY COALESCE(s.last_checked_at, '1970-01-01') ASC
      LIMIT ?
    `).all(limit) as MonitorRow[]).map(mapMonitor);
  }

  createMonitor(input: MonitorInput): AvailabilityMonitor {
    this.validateInput(input);
    const create = this.db.transaction(() => {
      const result = this.db.prepare(`
        INSERT INTO monitors (
          name, type, target, port, http_method, expected_status_min,
          expected_status_max, dns_server, dns_record_type, dns_expected,
          interval_seconds, timeout_ms, failure_threshold, recovery_threshold,
          latency_warning_ms, enabled
        ) VALUES (
          @name, @type, @target, @port, @httpMethod, @expectedStatusMin,
          @expectedStatusMax, @dnsServer, @dnsRecordType, @dnsExpected,
          @intervalSeconds, @timeoutMs, @failureThreshold, @recoveryThreshold,
          @latencyWarningMs, @enabled
        )
      `).run(this.withDefaults(input));
      const id = Number(result.lastInsertRowid);
      this.db.prepare(`
        INSERT INTO monitor_states (monitor_id, status) VALUES (?, ?)
      `).run(id, input.enabled === false ? 'paused' : 'pending');
      return id;
    });
    return this.getMonitor(create())!;
  }

  updateMonitor(id: number, input: Partial<MonitorInput>): AvailabilityMonitor | undefined {
    const current = this.getMonitor(id);
    if (!current) return undefined;
    const merged: MonitorInput = {
      name: input.name ?? current.name,
      type: input.type ?? current.type,
      target: input.target ?? current.target,
      port: input.port === undefined ? current.port : input.port,
      httpMethod: input.httpMethod ?? current.httpMethod,
      expectedStatusMin: input.expectedStatusMin ?? current.expectedStatusMin,
      expectedStatusMax: input.expectedStatusMax ?? current.expectedStatusMax,
      dnsServer: input.dnsServer === undefined ? current.dnsServer : input.dnsServer,
      dnsRecordType: input.dnsRecordType ?? current.dnsRecordType,
      dnsExpected: input.dnsExpected === undefined ? current.dnsExpected : input.dnsExpected,
      intervalSeconds: input.intervalSeconds ?? current.intervalSeconds,
      timeoutMs: input.timeoutMs ?? current.timeoutMs,
      failureThreshold: input.failureThreshold ?? current.failureThreshold,
      recoveryThreshold: input.recoveryThreshold ?? current.recoveryThreshold,
      latencyWarningMs: input.latencyWarningMs === undefined ? current.latencyWarningMs : input.latencyWarningMs,
      enabled: input.enabled ?? current.enabled,
    };
    this.validateInput(merged);
    const update = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE monitors SET
          name = @name, type = @type, target = @target, port = @port,
          http_method = @httpMethod, expected_status_min = @expectedStatusMin,
          expected_status_max = @expectedStatusMax, dns_server = @dnsServer,
          dns_record_type = @dnsRecordType, dns_expected = @dnsExpected,
          interval_seconds = @intervalSeconds, timeout_ms = @timeoutMs,
          failure_threshold = @failureThreshold, recovery_threshold = @recoveryThreshold,
          latency_warning_ms = @latencyWarningMs, enabled = @enabled,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
      `).run({ id, ...this.withDefaults(merged) });
      this.db.prepare(`
        INSERT INTO monitor_states (monitor_id, status)
        VALUES (?, ?)
        ON CONFLICT(monitor_id) DO UPDATE SET
          status = excluded.status,
          consecutive_failures = 0,
          consecutive_successes = 0
      `).run(id, merged.enabled === false ? 'paused' : (current.enabled ? current.status : 'pending'));
    });
    update();
    return this.getMonitor(id);
  }

  deleteMonitor(id: number): boolean {
    const remove = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM monitor_minute_stats WHERE monitor_id = ?`).run(id);
      this.db.prepare(`DELETE FROM monitor_hourly_stats WHERE monitor_id = ?`).run(id);
      this.db.prepare(`DELETE FROM monitor_incidents WHERE monitor_id = ?`).run(id);
      this.db.prepare(`DELETE FROM monitor_states WHERE monitor_id = ?`).run(id);
      return this.db.prepare(`DELETE FROM monitors WHERE id = ?`).run(id).changes > 0;
    });
    return remove();
  }

  recordCheck(id: number, result: MonitorCheckResult): MonitorTransition {
    const record = this.db.transaction(() => {
      const monitor = this.getMonitor(id);
      if (!monitor) throw new Error('Monitor not found');
      const state = this.db.prepare(`
        SELECT status, consecutive_failures, consecutive_successes
        FROM monitor_states WHERE monitor_id = ?
      `).get(id) as {
        status: MonitorStatus;
        consecutive_failures: number;
        consecutive_successes: number;
      } | undefined;
      const previousStatus = state?.status ?? 'pending';
      let failures = state?.consecutive_failures ?? 0;
      let successes = state?.consecutive_successes ?? 0;
      let currentStatus: MonitorStatus = previousStatus;

      if (result.status === 'down') {
        failures += 1;
        successes = 0;
        if (failures >= monitor.failureThreshold) currentStatus = 'down';
      } else {
        failures = 0;
        successes += 1;
        if (previousStatus !== 'down' || successes >= monitor.recoveryThreshold) {
          currentStatus = result.status;
        }
      }

      const minute = `${result.checkedAt.slice(0, 16)}:00`;
      const hour = `${result.checkedAt.slice(0, 13)}:00:00`;
      this.upsertHistory('monitor_minute_stats', 'minute', minute, id, result);
      this.upsertHistory('monitor_hourly_stats', 'hour', hour, id, result);

      this.db.prepare(`
        INSERT INTO monitor_states (
          monitor_id, status, consecutive_failures, consecutive_successes,
          last_checked_at, last_up_at, last_down_at, latency_ms, message
        ) VALUES (
          @id, @status, @failures, @successes, @checkedAt,
          CASE WHEN @observedStatus <> 'down' THEN @checkedAt END,
          CASE WHEN @status = 'down' THEN @checkedAt END,
          @latencyMs, @message
        )
        ON CONFLICT(monitor_id) DO UPDATE SET
          status = @status,
          consecutive_failures = @failures,
          consecutive_successes = @successes,
          last_checked_at = @checkedAt,
          last_up_at = CASE WHEN @observedStatus <> 'down' THEN @checkedAt ELSE monitor_states.last_up_at END,
          last_down_at = CASE
            WHEN @status = 'down' AND @previousStatus <> 'down' THEN @checkedAt
            ELSE monitor_states.last_down_at
          END,
          latency_ms = @latencyMs,
          message = @message
      `).run({
        id,
        status: currentStatus,
        previousStatus,
        observedStatus: result.status,
        failures,
        successes,
        checkedAt: result.checkedAt,
        latencyMs: result.latencyMs,
        message: result.message,
      });

      if (previousStatus !== 'down' && currentStatus === 'down') {
        this.db.prepare(`
          INSERT OR IGNORE INTO monitor_incidents
            (monitor_id, started_at, status, cause, message)
          VALUES (?, ?, 'open', 'check_failed', ?)
        `).run(id, result.checkedAt, result.message);
      } else if (previousStatus === 'down' && currentStatus !== 'down') {
        this.db.prepare(`
          UPDATE monitor_incidents
          SET status = 'resolved', ended_at = ?, message = ?
          WHERE monitor_id = ? AND status = 'open'
        `).run(result.checkedAt, result.message, id);
      }

      return { previousStatus, currentStatus };
    });
    const transition = record();
    return {
      monitor: this.getMonitor(id)!,
      ...transition,
      changed: transition.previousStatus !== transition.currentStatus,
    };
  }

  private upsertHistory(
    table: 'monitor_minute_stats' | 'monitor_hourly_stats',
    timeColumn: 'minute' | 'hour',
    time: string,
    id: number,
    result: MonitorCheckResult,
  ): void {
    const latency = result.latencyMs ?? 0;
    const hasLatency = result.latencyMs !== null;
    this.db.prepare(`
      INSERT INTO ${table} (
        monitor_id, ${timeColumn}, checks, up_checks, down_checks, degraded_checks,
        latency_sum, latency_min, latency_max, last_status
      ) VALUES (
        @id, @time, 1, @up, @down, @degraded,
        @latency, @latencyMin, @latencyMax, @status
      )
      ON CONFLICT(monitor_id, ${timeColumn}) DO UPDATE SET
        checks = checks + 1,
        up_checks = up_checks + @up,
        down_checks = down_checks + @down,
        degraded_checks = degraded_checks + @degraded,
        latency_sum = latency_sum + @latency,
        latency_min = CASE WHEN @latencyMin IS NULL THEN latency_min WHEN latency_min IS NULL THEN @latencyMin ELSE MIN(latency_min, @latencyMin) END,
        latency_max = CASE WHEN @latencyMax IS NULL THEN latency_max WHEN latency_max IS NULL THEN @latencyMax ELSE MAX(latency_max, @latencyMax) END,
        last_status = @status
    `).run({
      id,
      time,
      up: result.status === 'down' ? 0 : 1,
      down: result.status === 'down' ? 1 : 0,
      degraded: result.status === 'degraded' ? 1 : 0,
      latency,
      latencyMin: hasLatency ? latency : null,
      latencyMax: hasLatency ? latency : null,
      status: result.status,
    });
  }

  getHistory(id: number, start: string, end: string): MonitorHistoryPoint[] {
    const spanMs = Date.parse(end) - Date.parse(start);
    if (!Number.isFinite(spanMs) || spanMs < 0) throw new Error('Invalid time range');
    const useHourly = spanMs > 48 * 60 * 60 * 1000;
    const table = useHourly ? 'monitor_hourly_stats' : 'monitor_minute_stats';
    const column = useHourly ? 'hour' : 'minute';
    const startKey = useHourly ? `${start.slice(0, 13)}:00:00` : `${start.slice(0, 16)}:00`;
    const endKey = useHourly ? `${end.slice(0, 13)}:00:00` : `${end.slice(0, 16)}:00`;
    const rows = this.db.prepare(`
      SELECT ${column} AS time, checks, up_checks, down_checks, degraded_checks,
             CASE WHEN (checks - down_checks) > 0
               THEN ROUND(CAST(latency_sum AS REAL) / (checks - down_checks)) END AS average_latency_ms,
             latency_min, latency_max, last_status
      FROM ${table}
      WHERE monitor_id = ? AND ${column} BETWEEN ? AND ?
      ORDER BY ${column} ASC
      LIMIT 20000
    `).all(id, startKey, endKey) as Array<{
      time: string; checks: number; up_checks: number; down_checks: number;
      degraded_checks: number; average_latency_ms: number | null;
      latency_min: number | null; latency_max: number | null; last_status: MonitorStatus;
    }>;
    return rows.map((row) => ({
      time: row.time,
      checks: row.checks,
      upChecks: row.up_checks,
      downChecks: row.down_checks,
      degradedChecks: row.degraded_checks,
      averageLatencyMs: row.average_latency_ms,
      minLatencyMs: row.latency_min,
      maxLatencyMs: row.latency_max,
      status: row.last_status,
    }));
  }

  getOverview(start: string, end: string, pointLimit = 96): MonitorOverviewItem[] {
    const safeLimit = Math.max(24, Math.min(240, Math.floor(pointLimit)));
    return this.getMonitors().map((monitor) => {
      const raw = this.getHistory(monitor.id, start, end);
      const chunkSize = Math.max(1, Math.ceil(raw.length / safeLimit));
      const history: MonitorHistoryPoint[] = [];
      for (let index = 0; index < raw.length; index += chunkSize) {
        const chunk = raw.slice(index, index + chunkSize);
        const checks = chunk.reduce((sum, point) => sum + point.checks, 0);
        const upChecks = chunk.reduce((sum, point) => sum + point.upChecks, 0);
        const downChecks = chunk.reduce((sum, point) => sum + point.downChecks, 0);
        const degradedChecks = chunk.reduce((sum, point) => sum + point.degradedChecks, 0);
        const latencyChecks = chunk.reduce((sum, point) => sum + Math.max(0, point.checks - point.downChecks), 0);
        const latencyWeight = chunk.reduce(
          (sum, point) => sum + (point.averageLatencyMs ?? 0) * Math.max(0, point.checks - point.downChecks),
          0,
        );
        const minValues = chunk.map((point) => point.minLatencyMs).filter((value): value is number => value !== null);
        const maxValues = chunk.map((point) => point.maxLatencyMs).filter((value): value is number => value !== null);
        history.push({
          time: chunk[0]?.time ?? '', checks, upChecks, downChecks, degradedChecks,
          averageLatencyMs: latencyChecks > 0 ? Math.round(latencyWeight / latencyChecks) : null,
          minLatencyMs: minValues.length ? Math.min(...minValues) : null,
          maxLatencyMs: maxValues.length ? Math.max(...maxValues) : null,
          status: downChecks > 0 ? 'down' : degradedChecks > 0 ? 'degraded' : chunk.at(-1)?.status ?? 'pending',
        });
      }
      const checks = raw.reduce((sum, point) => sum + point.checks, 0);
      const upChecks = raw.reduce((sum, point) => sum + point.upChecks, 0);
      const downChecks = raw.reduce((sum, point) => sum + point.downChecks, 0);
      const degradedChecks = raw.reduce((sum, point) => sum + point.degradedChecks, 0);
      return {
        monitorId: monitor.id,
        availability: checks > 0 ? upChecks / checks : null,
        checks, upChecks, downChecks, degradedChecks, history,
      };
    });
  }

  getIncidents(limit = 100): MonitorIncident[] {
    const rows = this.db.prepare(`
      SELECT i.id, i.monitor_id, m.name AS monitor_name, i.started_at,
             i.ended_at, i.status, i.cause, i.message
      FROM monitor_incidents i
      JOIN monitors m ON m.id = i.monitor_id
      ORDER BY i.started_at DESC
      LIMIT ?
    `).all(limit) as Array<{
      id: number; monitor_id: number; monitor_name: string; started_at: string;
      ended_at: string | null; status: 'open' | 'resolved'; cause: string | null; message: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      monitorId: row.monitor_id,
      monitorName: row.monitor_name,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: row.status,
      cause: row.cause,
      message: row.message,
    }));
  }

  seedHomeNetworkMonitors(): void {
    if (this.getMonitors().length > 0) return;
    const defaults: MonitorInput[] = [
      { name: '主路由-Ping', type: 'icmp', target: '10.0.1.1', intervalSeconds: 30 },
      { name: 'Wi-Fi 7 AP-Ping', type: 'icmp', target: '10.0.1.2', intervalSeconds: 60 },
      { name: 'QNAP-Adapter1', type: 'icmp', target: '10.0.1.8', intervalSeconds: 30 },
      { name: 'QNAP-Adapter2', type: 'icmp', target: '10.0.1.9', intervalSeconds: 30 },
      { name: 'QTS-管理端口', type: 'tcp', target: '10.0.1.9', port: 5000 },
      { name: 'Jellyfin', type: 'http', target: 'http://10.0.1.9:8096', expectedStatusMin: 200, expectedStatusMax: 499 },
      { name: 'iStoreOS-Ping', type: 'icmp', target: '10.0.1.10', intervalSeconds: 30 },
      { name: 'iStoreOS-LuCI', type: 'tcp', target: '10.0.1.10', port: 80 },
      { name: 'DNS-百度', type: 'dns', target: 'www.baidu.com', dnsServer: '10.0.1.10', dnsRecordType: 'A', intervalSeconds: 30, timeoutMs: 2000 },
      { name: 'DNS-Google', type: 'dns', target: 'www.google.com', dnsServer: '10.0.1.10', dnsRecordType: 'A', timeoutMs: 3000 },
      { name: '公共DNS-阿里', type: 'tcp', target: '223.5.5.5', port: 53, intervalSeconds: 30 },
      { name: '公共DNS-腾讯', type: 'tcp', target: '119.29.29.29', port: 53, intervalSeconds: 30 },
      { name: '国内HTTP', type: 'http', target: 'https://www.baidu.com/', expectedStatusMin: 200, expectedStatusMax: 399 },
      { name: '代理HTTP', type: 'http', target: 'https://www.google.com/generate_204', expectedStatusMin: 200, expectedStatusMax: 299 },
    ];
    const seed = this.db.transaction(() => {
      for (const monitor of defaults) this.createMonitor(monitor);
    });
    seed();
  }

  getWebhookConfig(): { enabled: boolean; url: string } {
    const rows = this.db.prepare(`
      SELECT key, value FROM app_config
      WHERE key IN ('monitor.webhook_enabled', 'monitor.webhook_url')
    `).all() as Array<{ key: string; value: string }>;
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return {
      enabled: values.get('monitor.webhook_enabled') === '1',
      url: values.get('monitor.webhook_url') || '',
    };
  }

  updateWebhookConfig(config: { enabled: boolean; url: string }): { enabled: boolean; url: string } {
    const update = this.db.prepare(`
      INSERT INTO app_config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `);
    const tx = this.db.transaction(() => {
      update.run('monitor.webhook_enabled', config.enabled ? '1' : '0');
      update.run('monitor.webhook_url', config.url.trim());
    });
    tx();
    return this.getWebhookConfig();
  }

  private withDefaults(input: MonitorInput): Record<string, string | number | null> {
    return {
      name: input.name.trim(),
      type: input.type,
      target: input.target.trim(),
      port: input.port ?? null,
      httpMethod: (input.httpMethod || 'GET').toUpperCase(),
      expectedStatusMin: input.expectedStatusMin ?? 200,
      expectedStatusMax: input.expectedStatusMax ?? 399,
      dnsServer: input.dnsServer?.trim() || null,
      dnsRecordType: (input.dnsRecordType || 'A').toUpperCase(),
      dnsExpected: input.dnsExpected?.trim() || null,
      intervalSeconds: input.intervalSeconds ?? 60,
      timeoutMs: input.timeoutMs ?? 5000,
      failureThreshold: input.failureThreshold ?? 3,
      recoveryThreshold: input.recoveryThreshold ?? 1,
      latencyWarningMs: input.latencyWarningMs ?? null,
      enabled: input.enabled === false ? 0 : 1,
    };
  }

  private validateInput(input: MonitorInput): void {
    if (!input.name?.trim() || !input.target?.trim()) throw new Error('name and target are required');
    if (!['icmp', 'tcp', 'http', 'dns'].includes(input.type)) throw new Error('Invalid monitor type');
    const target = input.target.trim();
    if (input.type !== 'http' && (target.startsWith('-') || /\s/.test(target))) {
      throw new Error('Target must be a hostname or IP address');
    }
    if (input.type === 'tcp' && (!input.port || input.port < 1 || input.port > 65535)) {
      throw new Error('TCP monitor requires a valid port');
    }
    if (input.type === 'http') {
      const url = new URL(input.target);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('HTTP monitor requires an http/https URL');
    }
    const statusMin = input.expectedStatusMin ?? 200;
    const statusMax = input.expectedStatusMax ?? 399;
    if (statusMin < 100 || statusMax > 599 || statusMin > statusMax) {
      throw new Error('Expected HTTP status range must be between 100 and 599');
    }
    if (!['A', 'AAAA', 'TXT', 'CNAME'].includes((input.dnsRecordType || 'A').toUpperCase())) {
      throw new Error('Invalid DNS record type');
    }
    const interval = input.intervalSeconds ?? 60;
    const timeout = input.timeoutMs ?? 5000;
    if (interval < 10 || interval > 86400) throw new Error('intervalSeconds must be between 10 and 86400');
    if (timeout < 250 || timeout > 60000) throw new Error('timeoutMs must be between 250 and 60000');
    if ((input.failureThreshold ?? 3) < 1 || (input.failureThreshold ?? 3) > 20) throw new Error('Invalid failureThreshold');
    if ((input.recoveryThreshold ?? 1) < 1 || (input.recoveryThreshold ?? 1) > 20) throw new Error('Invalid recoveryThreshold');
    if (input.latencyWarningMs !== undefined && input.latencyWarningMs !== null && input.latencyWarningMs < 1) {
      throw new Error('latencyWarningMs must be positive');
    }
  }
}
