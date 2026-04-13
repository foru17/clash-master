/**
 * Traffic Writer Repository
 *
 * Handles writing traffic data to the database. Contains the two main
 * write methods: updateTrafficStats (single) and batchUpdateTrafficStats (batch).
 */
import type Database from 'better-sqlite3';
import { BaseRepository } from './base.repository.js';
import { buildRuleName } from '../../shared/utils/rule-name.js';

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
}

export class TrafficWriterRepository extends BaseRepository {
  // Cached prepared statements for single-write path (avoids re-compilation per call)
  private _singleStmts: ReturnType<TrafficWriterRepository['prepareSingleStmts']> | null = null;

  constructor(db: Database.Database) {
    super(db);
  }

  private normalizeConnections(value: number | undefined): number {
    const safe =
      typeof value === 'number' && Number.isFinite(value) ? value : 1;
    return Math.max(0, Math.floor(safe));
  }

  private prepareSingleStmts() {
    return {
      domainUpsert: this.db.prepare(`
        INSERT INTO domain_stats (backend_id, domain, ips, total_upload, total_download, total_connections, last_seen, rules, chains)
        VALUES (@backendId, @domain, @ip, @upload, @download, 1, @timestamp, @rule, @chain)
        ON CONFLICT(backend_id, domain) DO UPDATE SET
          ips = CASE WHEN domain_stats.ips IS NULL THEN @ip WHEN INSTR(domain_stats.ips, @ip) > 0 THEN domain_stats.ips ELSE domain_stats.ips || ',' || @ip END,
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + 1, last_seen = @timestamp,
          rules = CASE WHEN domain_stats.rules IS NULL THEN @rule WHEN INSTR(domain_stats.rules, @rule) > 0 THEN domain_stats.rules ELSE domain_stats.rules || ',' || @rule END,
          chains = CASE WHEN domain_stats.chains IS NULL THEN @chain WHEN INSTR(domain_stats.chains, @chain) > 0 THEN domain_stats.chains ELSE domain_stats.chains || ',' || @chain END
      `),
      ipUpsert: this.db.prepare(`
        INSERT INTO ip_stats (backend_id, ip, domains, total_upload, total_download, total_connections, last_seen, chains, rules)
        VALUES (@backendId, @ip, @domain, @upload, @download, 1, @timestamp, @chain, @rule)
        ON CONFLICT(backend_id, ip) DO UPDATE SET
          domains = CASE WHEN ip_stats.domains IS NULL THEN @domain WHEN INSTR(ip_stats.domains, @domain) > 0 THEN ip_stats.domains ELSE ip_stats.domains || ',' || @domain END,
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + 1, last_seen = @timestamp,
          chains = CASE WHEN ip_stats.chains IS NULL THEN @chain WHEN INSTR(ip_stats.chains, @chain) > 0 THEN ip_stats.chains ELSE ip_stats.chains || ',' || @chain END,
          rules = CASE WHEN ip_stats.rules IS NULL THEN @rule WHEN INSTR(ip_stats.rules, @rule) > 0 THEN ip_stats.rules ELSE ip_stats.rules || ',' || @rule END
      `),
      proxyUpsert: this.db.prepare(`
        INSERT INTO proxy_stats (backend_id, chain, total_upload, total_download, total_connections, last_seen)
        VALUES (@backendId, @chain, @upload, @download, 1, @timestamp)
        ON CONFLICT(backend_id, chain) DO UPDATE SET
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + 1, last_seen = @timestamp
      `),
      ruleUpsert: this.db.prepare(`
        INSERT INTO rule_stats (backend_id, rule, final_proxy, total_upload, total_download, total_connections, last_seen)
        VALUES (@backendId, @rule, @finalProxy, @upload, @download, 1, @timestamp)
        ON CONFLICT(backend_id, rule) DO UPDATE SET
          final_proxy = @finalProxy, total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + 1, last_seen = @timestamp
      `),
      ruleChainUpsert: this.db.prepare(`
        INSERT INTO rule_chain_traffic (backend_id, rule, chain, total_upload, total_download, total_connections, last_seen)
        VALUES (@backendId, @rule, @chain, @upload, @download, 1, @timestamp)
        ON CONFLICT(backend_id, rule, chain) DO UPDATE SET
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + 1, last_seen = @timestamp
      `),
      ruleDomainUpsert: this.db.prepare(`
        INSERT INTO rule_domain_traffic (backend_id, rule, domain, total_upload, total_download, total_connections, last_seen)
        VALUES (@backendId, @rule, @domain, @upload, @download, 1, @timestamp)
        ON CONFLICT(backend_id, rule, domain) DO UPDATE SET
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + 1, last_seen = @timestamp
      `),
      ruleIpUpsert: this.db.prepare(`
        INSERT INTO rule_ip_traffic (backend_id, rule, ip, total_upload, total_download, total_connections, last_seen)
        VALUES (@backendId, @rule, @ip, @upload, @download, 1, @timestamp)
        ON CONFLICT(backend_id, rule, ip) DO UPDATE SET
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + 1, last_seen = @timestamp
      `),
      ruleProxyInsert: this.db.prepare(`INSERT OR IGNORE INTO rule_proxy_map (backend_id, rule, proxy) VALUES (@backendId, @rule, @proxy)`),
      hourlyUpsert: this.db.prepare(`
        INSERT INTO hourly_stats (backend_id, hour, upload, download, connections) VALUES (@backendId, @hour, @upload, @download, 1)
        ON CONFLICT(backend_id, hour) DO UPDATE SET upload = upload + @upload, download = download + @download, connections = connections + 1
      `),
      minuteUpsert: this.db.prepare(`
        INSERT INTO minute_stats (backend_id, minute, upload, download, connections) VALUES (@backendId, @minute, @upload, @download, 1)
        ON CONFLICT(backend_id, minute) DO UPDATE SET upload = upload + @upload, download = download + @download, connections = connections + 1
      `),
      domainProxyUpsert: this.db.prepare(`
        INSERT INTO domain_proxy_stats (backend_id, domain, chain, total_upload, total_download, total_connections, last_seen)
        VALUES (@backendId, @domain, @chain, @upload, @download, 1, @timestamp)
        ON CONFLICT(backend_id, domain, chain) DO UPDATE SET
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + 1, last_seen = @timestamp
      `),
      ipProxyUpsert: this.db.prepare(`
        INSERT INTO ip_proxy_stats (backend_id, ip, chain, total_upload, total_download, total_connections, last_seen, domains)
        VALUES (@backendId, @ip, @chain, @upload, @download, 1, @timestamp, @domain)
        ON CONFLICT(backend_id, ip, chain) DO UPDATE SET
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + 1, last_seen = @timestamp,
          domains = CASE WHEN ip_proxy_stats.domains IS NULL THEN @domain WHEN @domain = 'unknown' THEN ip_proxy_stats.domains
            WHEN INSTR(ip_proxy_stats.domains, @domain) > 0 THEN ip_proxy_stats.domains ELSE ip_proxy_stats.domains || ',' || @domain END
      `),
      minuteDimUpsert: this.db.prepare(`
        INSERT INTO minute_dim_stats (backend_id, minute, domain, ip, source_ip, chain, rule, upload, download, connections)
        VALUES (@backendId, @minute, @domain, @ip, @sourceIP, @chain, @rule, @upload, @download, 1)
        ON CONFLICT(backend_id, minute, domain, ip, source_ip, chain, rule) DO UPDATE SET
          upload = upload + @upload, download = download + @download, connections = connections + 1
      `),
      hourlyDimUpsert: this.db.prepare(`
        INSERT INTO hourly_dim_stats (backend_id, hour, domain, ip, source_ip, chain, rule, upload, download, connections)
        VALUES (@backendId, @hour, @domain, @ip, @sourceIP, @chain, @rule, @upload, @download, 1)
        ON CONFLICT(backend_id, hour, domain, ip, source_ip, chain, rule) DO UPDATE SET
          upload = upload + @upload, download = download + @download, connections = connections + 1
      `),
    };
  }

  private get singleStmts() {
    if (!this._singleStmts) {
      this._singleStmts = this.prepareSingleStmts();
    }
    return this._singleStmts;
  }

  updateTrafficStats(backendId: number, update: TrafficUpdate) {
    const now = new Date();
    const timestamp = now.toISOString();
    const hour = timestamp.slice(0, 13) + ':00:00';
    const minute = timestamp.slice(0, 16) + ':00';

    if (update.upload === 0 && update.download === 0) return;

    const ruleName = buildRuleName(update);
    const finalProxy = update.chains.length > 0 ? update.chains[0] : 'DIRECT';
    const fullChain = update.chains.join(' > ') || update.chain || 'DIRECT';
    const s = this.singleStmts;

    const transaction = this.db.transaction(() => {
      const domainName = update.domain || 'unknown';
      if (domainName !== 'unknown') {
        s.domainUpsert.run({ backendId, domain: domainName, ip: update.ip, upload: update.upload, download: update.download, timestamp, rule: ruleName, chain: fullChain });
      }

      s.ipUpsert.run({ backendId, ip: update.ip, domain: update.domain || 'unknown', upload: update.upload, download: update.download, timestamp, chain: fullChain, rule: ruleName });
      s.proxyUpsert.run({ backendId, chain: fullChain, upload: update.upload, download: update.download, timestamp });
      s.ruleUpsert.run({ backendId, rule: ruleName, finalProxy, upload: update.upload, download: update.download, timestamp });
      s.ruleChainUpsert.run({ backendId, rule: ruleName, chain: fullChain, upload: update.upload, download: update.download, timestamp });

      if (domainName !== 'unknown') {
        s.ruleDomainUpsert.run({ backendId, rule: ruleName, domain: domainName, upload: update.upload, download: update.download, timestamp });
      }

      s.ruleIpUpsert.run({ backendId, rule: ruleName, ip: update.ip, upload: update.upload, download: update.download, timestamp });

      if (update.chains.length > 1) {
        s.ruleProxyInsert.run({ backendId, rule: ruleName, proxy: update.chains[0] });
      }

      s.hourlyUpsert.run({ backendId, hour, upload: update.upload, download: update.download });
      s.minuteUpsert.run({ backendId, minute, upload: update.upload, download: update.download });

      if (domainName !== 'unknown') {
        s.domainProxyUpsert.run({ backendId, domain: domainName, chain: fullChain, upload: update.upload, download: update.download, timestamp });
      }

      s.ipProxyUpsert.run({ backendId, ip: update.ip, chain: fullChain, upload: update.upload, download: update.download, timestamp, domain: update.domain || 'unknown' });

      // Write to minute_dim_stats and hourly_dim_stats
      const dimParams = { backendId, domain: update.domain || '', ip: update.ip || '', sourceIP: update.sourceIP || '', chain: fullChain, rule: ruleName, upload: update.upload, download: update.download };
      s.minuteDimUpsert.run({ ...dimParams, minute });
      s.hourlyDimUpsert.run({ ...dimParams, hour });
    });

    transaction();
  }

  batchUpdateTrafficStats(backendId: number, updates: TrafficUpdate[], reduceWrites = false) {
    if (updates.length === 0) return;

    const now = new Date();
    const timestamp = now.toISOString();

    // Aggregate updates by domain, ip, chain to reduce UPSERT conflicts
    const domainMap = new Map<string, TrafficUpdate & { count: number }>();
    const ipMap = new Map<string, TrafficUpdate & { count: number }>();
    const chainMap = new Map<string, { chains: string[]; upload: number; download: number; count: number }>();
    const ruleProxyMap = new Map<string, { rule: string; proxy: string; upload: number; download: number; count: number }>();
    const hourlyMap = new Map<string, { upload: number; download: number; connections: number }>();
    const ruleChainMap = new Map<string, { rule: string; chain: string; upload: number; download: number; count: number }>();
    const ruleDomainMap = new Map<string, { rule: string; domain: string; upload: number; download: number; count: number }>();
    const ruleIPMap = new Map<string, { rule: string; ip: string; upload: number; download: number; count: number }>();
    const minuteMap = new Map<string, { upload: number; download: number; connections: number }>();
    const minuteDimMap = new Map<string, {
      minute: string; domain: string; ip: string; sourceIP: string;
      chain: string; rule: string; upload: number; download: number; connections: number;
    }>();
    const hourlyDimMap = new Map<string, {
      hour: string; domain: string; ip: string; sourceIP: string;
      chain: string; rule: string; upload: number; download: number; connections: number;
    }>();
    const domainProxyMap = new Map<string, { domain: string; chain: string; upload: number; download: number; count: number }>();
    const ipProxyMap = new Map<string, { ip: string; chain: string; upload: number; download: number; count: number; domains: Set<string> }>();
    const deviceMap = new Map<string, { sourceIP: string; upload: number; download: number; count: number }>();
    const deviceDomainMap = new Map<string, { sourceIP: string; domain: string; upload: number; download: number; count: number }>();
    const deviceIPMap = new Map<string, { sourceIP: string; ip: string; upload: number; download: number; count: number }>();

    // Cache Date→key conversions: many updates share the same timestampMs
    const timeKeyCache = new Map<number, { hourKey: string; minuteKey: string }>();
    const getTimeKeys = (tsMs: number) => {
      let cached = timeKeyCache.get(tsMs);
      if (!cached) {
        const d = new Date(tsMs);
        cached = { hourKey: this.toHourKey(d), minuteKey: this.toMinuteKey(d) };
        timeKeyCache.set(tsMs, cached);
      }
      return cached;
    };

    for (const update of updates) {
      if (update.upload === 0 && update.download === 0) continue;
      const connections = this.normalizeConnections(update.connections);

      const ruleName = buildRuleName(update);
      const finalProxy = update.chains.length > 0 ? update.chains[0] : 'DIRECT';
      const fullChain = update.chains.join(' > ') || update.chain || 'DIRECT';
      const { hourKey, minuteKey } = getTimeKeys(update.timestampMs ?? now.getTime());

      // Aggregate domain stats
      if (update.domain) {
        const domainKey = `${update.domain}:${update.ip}:${fullChain}`;
        const existing = domainMap.get(domainKey);
        if (existing) {
          existing.upload += update.upload;
          existing.download += update.download;
          existing.count += connections;
        } else {
          domainMap.set(domainKey, { ...update, count: connections });
        }
      }

      // Aggregate IP stats
      const ipKey = `${update.ip}:${update.domain}:${fullChain}`;
      const existingIp = ipMap.get(ipKey);
      if (existingIp) {
        existingIp.upload += update.upload;
        existingIp.download += update.download;
        existingIp.count += connections;
      } else {
        ipMap.set(ipKey, { ...update, rule: ruleName, count: connections });
      }

      // Aggregate chain stats
      const existingChain = chainMap.get(fullChain);
      if (existingChain) {
        existingChain.upload += update.upload;
        existingChain.download += update.download;
        existingChain.count += connections;
      } else {
        chainMap.set(fullChain, {
          chains: update.chains,
          upload: update.upload,
          download: update.download,
          count: connections,
        });
      }

      // Aggregate rule stats
      const ruleKey = `${ruleName}:${finalProxy}`;
      const existingRule = ruleProxyMap.get(ruleKey);
      if (existingRule) {
        existingRule.upload += update.upload;
        existingRule.download += update.download;
        existingRule.count += connections;
      } else {
        ruleProxyMap.set(ruleKey, {
          rule: ruleName,
          proxy: finalProxy,
          upload: update.upload,
          download: update.download,
          count: connections,
        });
      }

      // Aggregate hourly stats
      const existingHour = hourlyMap.get(hourKey);
      if (existingHour) {
        existingHour.upload += update.upload;
        existingHour.download += update.download;
        existingHour.connections += connections;
      } else {
        hourlyMap.set(hourKey, {
          upload: update.upload,
          download: update.download,
          connections,
        });
      }

      // Aggregate rule_chain_traffic
      const fullChainForRule = update.chains.join(' > ');
      const ruleChainKey = `${ruleName}:${fullChainForRule}`;
      const existingRuleChain = ruleChainMap.get(ruleChainKey);
      if (existingRuleChain) {
        existingRuleChain.upload += update.upload;
        existingRuleChain.download += update.download;
        existingRuleChain.count += connections;
      } else {
        ruleChainMap.set(ruleChainKey, {
          rule: ruleName,
          chain: fullChainForRule,
          upload: update.upload,
          download: update.download,
          count: connections,
        });
      }

      // Aggregate rule_domain_traffic
      if (update.domain) {
        const rdKey = `${ruleName}:${update.domain}`;
        const existingRD = ruleDomainMap.get(rdKey);
        if (existingRD) {
          existingRD.upload += update.upload;
          existingRD.download += update.download;
          existingRD.count += connections;
        } else {
          ruleDomainMap.set(rdKey, {
            rule: ruleName,
            domain: update.domain,
            upload: update.upload,
            download: update.download,
            count: connections,
          });
        }
      }

      // Aggregate rule_ip_traffic
      const riKey = `${ruleName}:${update.ip}`;
      const existingRI = ruleIPMap.get(riKey);
      if (existingRI) {
        existingRI.upload += update.upload;
        existingRI.download += update.download;
        existingRI.count += connections;
      } else {
        ruleIPMap.set(riKey, {
          rule: ruleName,
          ip: update.ip,
          upload: update.upload,
          download: update.download,
          count: connections,
        });
      }

      // Aggregate minute_stats
      const existingMinute = minuteMap.get(minuteKey);
      if (existingMinute) {
        existingMinute.upload += update.upload;
        existingMinute.download += update.download;
        existingMinute.connections += connections;
      } else {
        minuteMap.set(minuteKey, {
          upload: update.upload,
          download: update.download,
          connections,
        });
      }

      // Aggregate minute_dim_stats
      const dimKey = `${minuteKey}:${update.domain || ''}:${update.ip || ''}:${update.sourceIP || ''}:${fullChain}:${ruleName}`;
      const existingDim = minuteDimMap.get(dimKey);
      if (existingDim) {
        existingDim.upload += update.upload;
        existingDim.download += update.download;
        existingDim.connections += connections;
      } else {
        minuteDimMap.set(dimKey, {
          minute: minuteKey,
          domain: update.domain || '',
          ip: update.ip || '',
          sourceIP: update.sourceIP || '',
          chain: fullChain,
          rule: ruleName,
          upload: update.upload,
          download: update.download,
          connections,
        });
      }

      // Aggregate hourly_dim_stats
      const hourlyDimKey = `${hourKey}:${update.domain || ''}:${update.ip || ''}:${update.sourceIP || ''}:${fullChain}:${ruleName}`;
      const existingHourlyDim = hourlyDimMap.get(hourlyDimKey);
      if (existingHourlyDim) {
        existingHourlyDim.upload += update.upload;
        existingHourlyDim.download += update.download;
        existingHourlyDim.connections += connections;
      } else {
        hourlyDimMap.set(hourlyDimKey, {
          hour: hourKey,
          domain: update.domain || '',
          ip: update.ip || '',
          sourceIP: update.sourceIP || '',
          chain: fullChain,
          rule: ruleName,
          upload: update.upload,
          download: update.download,
          connections,
        });
      }

      // Aggregate domain_proxy_stats
      if (update.domain) {
        const dpKey = `${update.domain}:${fullChain}`;
        const existingDP = domainProxyMap.get(dpKey);
        if (existingDP) {
          existingDP.upload += update.upload;
          existingDP.download += update.download;
          existingDP.count += connections;
        } else {
          domainProxyMap.set(dpKey, {
            domain: update.domain,
            chain: fullChain,
            upload: update.upload,
            download: update.download,
            count: connections,
          });
        }
      }

      // Aggregate ip_proxy_stats
      const ipPKey = `${update.ip}:${fullChain}`;
      const existingIPP = ipProxyMap.get(ipPKey);
      if (existingIPP) {
        existingIPP.upload += update.upload;
        existingIPP.download += update.download;
        existingIPP.count += connections;
        if (update.domain && update.domain !== 'unknown') existingIPP.domains.add(update.domain);
      } else {
        const domains = new Set<string>();
        if (update.domain && update.domain !== 'unknown') domains.add(update.domain);
        ipProxyMap.set(ipPKey, {
          ip: update.ip,
          chain: fullChain,
          upload: update.upload,
          download: update.download,
          count: connections,
          domains,
        });
      }

      // Aggregate device stats
      if (update.sourceIP) {
        const sourceIP = update.sourceIP;
        const existingDevice = deviceMap.get(sourceIP);
        if (existingDevice) {
          existingDevice.upload += update.upload;
          existingDevice.download += update.download;
          existingDevice.count += connections;
        } else {
          deviceMap.set(sourceIP, {
            sourceIP,
            upload: update.upload,
            download: update.download,
            count: connections,
          });
        }

        if (update.domain) {
          const ddKey = `${sourceIP}:${update.domain}`;
          const existingDD = deviceDomainMap.get(ddKey);
          if (existingDD) {
            existingDD.upload += update.upload;
            existingDD.download += update.download;
            existingDD.count += connections;
          } else {
            deviceDomainMap.set(ddKey, {
              sourceIP,
              domain: update.domain,
              upload: update.upload,
              download: update.download,
              count: connections,
            });
          }
        }

        if (update.ip) {
          const diKey = `${sourceIP}:${update.ip}`;
          const existingDI = deviceIPMap.get(diKey);
          if (existingDI) {
            existingDI.upload += update.upload;
            existingDI.download += update.download;
            existingDI.count += connections;
          } else {
            deviceIPMap.set(diKey, {
              sourceIP,
              ip: update.ip,
              upload: update.upload,
              download: update.download,
              count: connections,
            });
          }
        }
      }
    }

    // Sub-transaction 1: Core aggregation tables
    const tx1 = this.db.transaction(() => {
      const domainStmt = this.db.prepare(`
        INSERT INTO domain_stats (backend_id, domain, ips, total_upload, total_download, total_connections, last_seen, rules, chains)
        VALUES (@backendId, @domain, @ip, @upload, @download, @count, @timestamp, @rule, @chain)
        ON CONFLICT(backend_id, domain) DO UPDATE SET
          ips = CASE WHEN domain_stats.ips IS NULL THEN @ip WHEN LENGTH(domain_stats.ips) > 4000 THEN domain_stats.ips WHEN INSTR(domain_stats.ips, @ip) > 0 THEN domain_stats.ips ELSE domain_stats.ips || ',' || @ip END,
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + @count, last_seen = @timestamp,
          rules = CASE WHEN domain_stats.rules IS NULL THEN @rule WHEN LENGTH(domain_stats.rules) > 4000 THEN domain_stats.rules WHEN INSTR(domain_stats.rules, @rule) > 0 THEN domain_stats.rules ELSE domain_stats.rules || ',' || @rule END,
          chains = CASE WHEN domain_stats.chains IS NULL THEN @chain WHEN LENGTH(domain_stats.chains) > 4000 THEN domain_stats.chains WHEN INSTR(domain_stats.chains, @chain) > 0 THEN domain_stats.chains ELSE domain_stats.chains || ',' || @chain END
      `);
      for (const [, data] of domainMap) {
        const ruleName = buildRuleName(data);
        const fullChain = data.chains.join(' > ');
        domainStmt.run({ backendId, domain: data.domain, ip: data.ip, upload: data.upload, download: data.download, count: data.count, timestamp, rule: ruleName, chain: fullChain });
      }

      const ipStmt = this.db.prepare(`
        INSERT INTO ip_stats (backend_id, ip, domains, total_upload, total_download, total_connections, last_seen, chains, rules)
        VALUES (@backendId, @ip, @domain, @upload, @download, @count, @timestamp, @chain, @rule)
        ON CONFLICT(backend_id, ip) DO UPDATE SET
          domains = CASE WHEN ip_stats.domains IS NULL THEN @domain WHEN LENGTH(ip_stats.domains) > 4000 THEN ip_stats.domains WHEN INSTR(ip_stats.domains, @domain) > 0 THEN ip_stats.domains ELSE ip_stats.domains || ',' || @domain END,
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + @count, last_seen = @timestamp,
          chains = CASE WHEN ip_stats.chains IS NULL THEN @chain WHEN LENGTH(ip_stats.chains) > 4000 THEN ip_stats.chains WHEN INSTR(ip_stats.chains, @chain) > 0 THEN ip_stats.chains ELSE ip_stats.chains || ',' || @chain END,
          rules = CASE WHEN ip_stats.rules IS NULL THEN @rule WHEN LENGTH(ip_stats.rules) > 4000 THEN ip_stats.rules WHEN INSTR(ip_stats.rules, @rule) > 0 THEN ip_stats.rules ELSE ip_stats.rules || ',' || @rule END
      `);
      for (const [, data] of ipMap) {
        const fullChain = data.chains.join(' > ');
        ipStmt.run({ backendId, ip: data.ip, domain: data.domain || 'unknown', upload: data.upload, download: data.download, count: data.count, timestamp, chain: fullChain, rule: data.rule });
      }

      const proxyStmt = this.db.prepare(`
        INSERT INTO proxy_stats (backend_id, chain, total_upload, total_download, total_connections, last_seen)
        VALUES (@backendId, @chain, @upload, @download, @count, @timestamp)
        ON CONFLICT(backend_id, chain) DO UPDATE SET
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + @count, last_seen = @timestamp
      `);
      for (const [chain, data] of chainMap) { proxyStmt.run({ backendId, chain, upload: data.upload, download: data.download, count: data.count, timestamp }); }

      const ruleStmt = this.db.prepare(`
        INSERT INTO rule_stats (backend_id, rule, final_proxy, total_upload, total_download, total_connections, last_seen)
        VALUES (@backendId, @rule, @proxy, @upload, @download, @count, @timestamp)
        ON CONFLICT(backend_id, rule) DO UPDATE SET
          final_proxy = @proxy, total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + @count, last_seen = @timestamp
      `);
      for (const [, data] of ruleProxyMap) { ruleStmt.run({ backendId, rule: data.rule, proxy: data.proxy, upload: data.upload, download: data.download, count: data.count, timestamp }); }

      const ruleProxyStmt = this.db.prepare(`INSERT OR IGNORE INTO rule_proxy_map (backend_id, rule, proxy) VALUES (@backendId, @rule, @proxy)`);
      for (const [, data] of ruleProxyMap) { ruleProxyStmt.run({ backendId, rule: data.rule, proxy: data.proxy }); }

      const hourlyStmt = this.db.prepare(`
        INSERT INTO hourly_stats (backend_id, hour, upload, download, connections) VALUES (@backendId, @hour, @upload, @download, @connections)
        ON CONFLICT(backend_id, hour) DO UPDATE SET upload = upload + @upload, download = download + @download, connections = connections + @connections
      `);
      for (const [hour, data] of hourlyMap) { hourlyStmt.run({ backendId, hour, upload: data.upload, download: data.download, connections: data.connections }); }

      const ruleChainStmt = this.db.prepare(`
        INSERT INTO rule_chain_traffic (backend_id, rule, chain, total_upload, total_download, total_connections, last_seen)
        VALUES (@backendId, @rule, @chain, @upload, @download, @count, @timestamp)
        ON CONFLICT(backend_id, rule, chain) DO UPDATE SET
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + @count, last_seen = @timestamp
      `);
      for (const [, data] of ruleChainMap) { ruleChainStmt.run({ backendId, rule: data.rule, chain: data.chain, upload: data.upload, download: data.download, count: data.count, timestamp }); }
    });
    
    if (!reduceWrites) {
      tx1();
    } else {
      // In reduceWrites mode (ClickHouse enabled), we still need hourly_stats and proxy_stats 
      // as they are minimal and useful for light queries. We skip domain, IP, and detailed rule maps
      // to drastically reduce B-tree updates and WAL amplification.
      const tx1Light = this.db.transaction(() => {
        const hourlyStmt = this.db.prepare(`
          INSERT INTO hourly_stats (backend_id, hour, upload, download, connections) VALUES (@backendId, @hour, @upload, @download, @connections)
          ON CONFLICT(backend_id, hour) DO UPDATE SET upload = upload + @upload, download = download + @download, connections = connections + @connections
        `);
        for (const [hour, data] of hourlyMap) { hourlyStmt.run({ backendId, hour, upload: data.upload, download: data.download, connections: data.connections }); }

        const proxyStmt = this.db.prepare(`
          INSERT INTO proxy_stats (backend_id, chain, total_upload, total_download, total_connections, last_seen)
          VALUES (@backendId, @chain, @upload, @download, @count, @timestamp)
          ON CONFLICT(backend_id, chain) DO UPDATE SET
            total_upload = total_upload + @upload, total_download = total_download + @download,
            total_connections = total_connections + @count, last_seen = @timestamp
        `);
        for (const [chain, data] of chainMap) { proxyStmt.run({ backendId, chain, upload: data.upload, download: data.download, count: data.count, timestamp }); }
      });
      tx1Light();
    }

    // Sub-transaction 2: Detail tables + minute/hourly tables
    const tx2 = this.db.transaction(() => {
      const minuteStmt = this.db.prepare(`
        INSERT INTO minute_stats (backend_id, minute, upload, download, connections) VALUES (@backendId, @minute, @upload, @download, @connections)
        ON CONFLICT(backend_id, minute) DO UPDATE SET upload = upload + @upload, download = download + @download, connections = connections + @connections
      `);
      for (const [minute, data] of minuteMap) { minuteStmt.run({ backendId, minute, upload: data.upload, download: data.download, connections: data.connections }); }

      if (!reduceWrites) {
        const ruleDomainStmt = this.db.prepare(`
          INSERT INTO rule_domain_traffic (backend_id, rule, domain, total_upload, total_download, total_connections, last_seen)
          VALUES (@backendId, @rule, @domain, @upload, @download, @count, @timestamp)
          ON CONFLICT(backend_id, rule, domain) DO UPDATE SET
            total_upload = total_upload + @upload, total_download = total_download + @download,
            total_connections = total_connections + @count, last_seen = @timestamp
        `);
        for (const [, data] of ruleDomainMap) { ruleDomainStmt.run({ backendId, rule: data.rule, domain: data.domain, upload: data.upload, download: data.download, count: data.count, timestamp }); }

        const ruleIPStmt = this.db.prepare(`
          INSERT INTO rule_ip_traffic (backend_id, rule, ip, total_upload, total_download, total_connections, last_seen)
          VALUES (@backendId, @rule, @ip, @upload, @download, @count, @timestamp)
          ON CONFLICT(backend_id, rule, ip) DO UPDATE SET
            total_upload = total_upload + @upload, total_download = total_download + @download,
            total_connections = total_connections + @count, last_seen = @timestamp
        `);
        for (const [, data] of ruleIPMap) { ruleIPStmt.run({ backendId, rule: data.rule, ip: data.ip, upload: data.upload, download: data.download, count: data.count, timestamp }); }

        const minuteDimStmt = this.db.prepare(`
          INSERT INTO minute_dim_stats (backend_id, minute, domain, ip, source_ip, chain, rule, upload, download, connections)
          VALUES (@backendId, @minute, @domain, @ip, @sourceIP, @chain, @rule, @upload, @download, @connections)
          ON CONFLICT(backend_id, minute, domain, ip, source_ip, chain, rule) DO UPDATE SET
            upload = upload + @upload, download = download + @download, connections = connections + @connections
        `);
        for (const [, data] of minuteDimMap) { minuteDimStmt.run({ backendId, minute: data.minute, domain: data.domain, ip: data.ip, sourceIP: data.sourceIP, chain: data.chain, rule: data.rule, upload: data.upload, download: data.download, connections: data.connections }); }

        const hourlyDimStmt = this.db.prepare(`
          INSERT INTO hourly_dim_stats (backend_id, hour, domain, ip, source_ip, chain, rule, upload, download, connections)
          VALUES (@backendId, @hour, @domain, @ip, @sourceIP, @chain, @rule, @upload, @download, @connections)
          ON CONFLICT(backend_id, hour, domain, ip, source_ip, chain, rule) DO UPDATE SET
            upload = upload + @upload, download = download + @download, connections = connections + @connections
        `);
        for (const [, data] of hourlyDimMap) { hourlyDimStmt.run({ backendId, hour: data.hour, domain: data.domain, ip: data.ip, sourceIP: data.sourceIP, chain: data.chain, rule: data.rule, upload: data.upload, download: data.download, connections: data.connections }); }

        const domainProxyStmt = this.db.prepare(`
          INSERT INTO domain_proxy_stats (backend_id, domain, chain, total_upload, total_download, total_connections, last_seen)
          VALUES (@backendId, @domain, @chain, @upload, @download, @count, @timestamp)
          ON CONFLICT(backend_id, domain, chain) DO UPDATE SET
            total_upload = total_upload + @upload, total_download = total_download + @download,
            total_connections = total_connections + @count, last_seen = @timestamp
        `);
        for (const [, data] of domainProxyMap) { domainProxyStmt.run({ backendId, domain: data.domain, chain: data.chain, upload: data.upload, download: data.download, count: data.count, timestamp }); }

        const ipProxyStmt = this.db.prepare(`
          INSERT INTO ip_proxy_stats (backend_id, ip, chain, total_upload, total_download, total_connections, last_seen)
          VALUES (@backendId, @ip, @chain, @upload, @download, @count, @timestamp)
          ON CONFLICT(backend_id, ip, chain) DO UPDATE SET
            total_upload = total_upload + @upload, total_download = total_download + @download,
            total_connections = total_connections + @count, last_seen = @timestamp
        `);
        const ipProxyDomainStmt = this.db.prepare(`
          UPDATE ip_proxy_stats SET domains = CASE
            WHEN domains IS NULL OR domains = '' THEN @domain
            WHEN LENGTH(domains) > 4000 THEN domains
            WHEN INSTR(',' || domains || ',', ',' || @domain || ',') > 0 THEN domains
            ELSE domains || ',' || @domain END
          WHERE backend_id = @backendId AND ip = @ip AND chain = @chain
        `);
        for (const [, data] of ipProxyMap) {
          ipProxyStmt.run({ backendId, ip: data.ip, chain: data.chain, upload: data.upload, download: data.download, count: data.count, timestamp });
          if (data.domains.size > 0) {
            for (const domain of data.domains) { ipProxyDomainStmt.run({ backendId, ip: data.ip, chain: data.chain, domain }); }
          }
        }
      }
    });
    tx2();

    // Sub-transaction 3: Device tables
    if (!reduceWrites) {
      const tx3 = this.db.transaction(() => {
      const deviceStmt = this.db.prepare(`
        INSERT INTO device_stats (backend_id, source_ip, total_upload, total_download, total_connections, last_seen)
        VALUES (@backendId, @sourceIP, @upload, @download, @count, @timestamp)
        ON CONFLICT(backend_id, source_ip) DO UPDATE SET
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + @count, last_seen = @timestamp
      `);
      for (const [, data] of deviceMap) { deviceStmt.run({ backendId, sourceIP: data.sourceIP, upload: data.upload, download: data.download, count: data.count, timestamp }); }

      const deviceDomainStmt = this.db.prepare(`
        INSERT INTO device_domain_stats (backend_id, source_ip, domain, total_upload, total_download, total_connections, last_seen)
        VALUES (@backendId, @sourceIP, @domain, @upload, @download, @count, @timestamp)
        ON CONFLICT(backend_id, source_ip, domain) DO UPDATE SET
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + @count, last_seen = @timestamp
      `);
      for (const [, data] of deviceDomainMap) { deviceDomainStmt.run({ backendId, sourceIP: data.sourceIP, domain: data.domain, upload: data.upload, download: data.download, count: data.count, timestamp }); }

      const deviceIPStmt = this.db.prepare(`
        INSERT INTO device_ip_stats (backend_id, source_ip, ip, total_upload, total_download, total_connections, last_seen)
        VALUES (@backendId, @sourceIP, @ip, @upload, @download, @count, @timestamp)
        ON CONFLICT(backend_id, source_ip, ip) DO UPDATE SET
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + @count, last_seen = @timestamp
      `);
      for (const [, data] of deviceIPMap) { deviceIPStmt.run({ backendId, sourceIP: data.sourceIP, ip: data.ip, upload: data.upload, download: data.download, count: data.count, timestamp }); }
      });
      tx3();
    }
  }
}
