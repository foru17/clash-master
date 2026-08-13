/**
 * Traffic Writer Repository
 *
 * Handles writing traffic data to the database. batchUpdateTrafficStats is
 * the single write implementation; updateTrafficStats wraps it for one-off writes.
 */
import type Database from 'better-sqlite3';
import { BaseRepository } from './base.repository.js';
import { buildRuleName } from '../../shared/utils/rule-name.js';
import { VendorClassifier } from '../vendor-classifier.js';
import { classifyProtocol } from '../protocol-classifier.js';
import { getRegistrableDomain } from '../registrable-domain.js';

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

export class TrafficWriterRepository extends BaseRepository {
  constructor(db: Database.Database) {
    super(db);
  }

  private normalizeConnections(value: number | undefined): number {
    const safe =
      typeof value === 'number' && Number.isFinite(value) ? value : 1;
    return Math.max(0, Math.floor(safe));
  }

  /**
   * Single-update convenience wrapper. All writes go through the batch path
   * so there is exactly one write implementation to keep in sync with the
   * schema (device tables, event-time bucketing, CSV caps, connections).
   */
  updateTrafficStats(backendId: number, update: TrafficUpdate) {
    this.batchUpdateTrafficStats(backendId, [update]);
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
    const vendorHourlyMap = new Map<string, {
      hour: string; sourceIP: string; vendorId: number;
      upload: number; download: number; connections: number;
    }>();
    const vendorDailyMap = new Map<string, {
      day: string; sourceIP: string; vendorId: number;
      upload: number; download: number; connections: number;
    }>();
    const vendorProtocolHourlyMap = new Map<string, {
      hour: string; sourceIP: string; vendorId: number; transport: string;
      applicationProtocol: string; confidence: string;
      upload: number; download: number; connections: number;
    }>();
    const vendorProtocolDailyMap = new Map<string, {
      day: string; sourceIP: string; vendorId: number; transport: string;
      applicationProtocol: string; confidence: string;
      upload: number; download: number; connections: number;
    }>();
    const vendorEndpointHourlyMap = new Map<string, {
      hour: string; sourceIP: string; vendorId: number; endpointType: 'domain' | 'ip';
      endpoint: string; transport: string; applicationProtocol: string; confidence: string;
      upload: number; download: number; connections: number;
    }>();
    const vendorEndpointDailyMap = new Map<string, {
      day: string; sourceIP: string; vendorId: number; endpointType: 'domain' | 'ip';
      endpoint: string; transport: string; applicationProtocol: string; confidence: string;
      upload: number; download: number; connections: number;
    }>();
    const observabilityHourlyMap = new Map<string, {
      hour: string; sourceIP: string; domainPresent: number;
      upload: number; download: number; connections: number;
    }>();
    const observabilityDailyMap = new Map<string, {
      day: string; sourceIP: string; domainPresent: number;
      upload: number; download: number; connections: number;
    }>();
    const unresolvedDailyMap = new Map<string, {
      day: string; sourceIP: string; registrableDomain: string;
      upload: number; download: number; connections: number;
    }>();
    const vendorClassifier = new VendorClassifier(this.db);

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
      const sourceIP = update.sourceIP || '';
      const vendorId = vendorClassifier.classify(update.domain);
      const protocol = classifyProtocol(update.network, update.destinationPort);
      const vendorHourlyKey = `${hourKey}:${sourceIP}:${vendorId}`;
      const vendorHourly = vendorHourlyMap.get(vendorHourlyKey);
      if (vendorHourly) {
        vendorHourly.upload += update.upload;
        vendorHourly.download += update.download;
        vendorHourly.connections += connections;
      } else {
        vendorHourlyMap.set(vendorHourlyKey, {
          hour: hourKey,
          sourceIP,
          vendorId,
          upload: update.upload,
          download: update.download,
          connections,
        });
      }
      const day = hourKey.slice(0, 10);
      const vendorDailyKey = `${day}:${sourceIP}:${vendorId}`;
      const vendorDaily = vendorDailyMap.get(vendorDailyKey);
      if (vendorDaily) {
        vendorDaily.upload += update.upload;
        vendorDaily.download += update.download;
        vendorDaily.connections += connections;
      } else {
        vendorDailyMap.set(vendorDailyKey, {
          day,
          sourceIP,
          vendorId,
          upload: update.upload,
          download: update.download,
          connections,
        });
      }

      const protocolHourlyKey = `${hourKey}:${sourceIP}:${vendorId}:${protocol.transport}:${protocol.applicationProtocol}:${protocol.confidence}`;
      const protocolHourly = vendorProtocolHourlyMap.get(protocolHourlyKey);
      if (protocolHourly) {
        protocolHourly.upload += update.upload;
        protocolHourly.download += update.download;
        protocolHourly.connections += connections;
      } else {
        vendorProtocolHourlyMap.set(protocolHourlyKey, {
          hour: hourKey,
          sourceIP,
          vendorId,
          transport: protocol.transport,
          applicationProtocol: protocol.applicationProtocol,
          confidence: protocol.confidence,
          upload: update.upload,
          download: update.download,
          connections,
        });
      }
      const protocolDailyKey = `${day}:${sourceIP}:${vendorId}:${protocol.transport}:${protocol.applicationProtocol}:${protocol.confidence}`;
      const protocolDaily = vendorProtocolDailyMap.get(protocolDailyKey);
      if (protocolDaily) {
        protocolDaily.upload += update.upload;
        protocolDaily.download += update.download;
        protocolDaily.connections += connections;
      } else {
        vendorProtocolDailyMap.set(protocolDailyKey, {
          day,
          sourceIP,
          vendorId,
          transport: protocol.transport,
          applicationProtocol: protocol.applicationProtocol,
          confidence: protocol.confidence,
          upload: update.upload,
          download: update.download,
          connections,
        });
      }

      const normalizedDomain = update.domain.trim().toLowerCase();
      const domainPresent = normalizedDomain && normalizedDomain !== 'unknown' ? 1 : 0;
      const endpointType: 'domain' | 'ip' = domainPresent === 1 ? 'domain' : 'ip';
      const endpoint = endpointType === 'domain' ? normalizedDomain : update.ip.trim();
      if (endpoint) {
        const endpointHourlyKey = `${hourKey}:${sourceIP}:${vendorId}:${endpointType}:${endpoint}:${protocol.transport}:${protocol.applicationProtocol}:${protocol.confidence}`;
        const endpointHourly = vendorEndpointHourlyMap.get(endpointHourlyKey);
        if (endpointHourly) {
          endpointHourly.upload += update.upload;
          endpointHourly.download += update.download;
          endpointHourly.connections += connections;
        } else {
          vendorEndpointHourlyMap.set(endpointHourlyKey, {
            hour: hourKey, sourceIP, vendorId, endpointType, endpoint,
            transport: protocol.transport, applicationProtocol: protocol.applicationProtocol,
            confidence: protocol.confidence, upload: update.upload, download: update.download,
            connections,
          });
        }
        const endpointDailyKey = `${day}:${sourceIP}:${vendorId}:${endpointType}:${endpoint}:${protocol.transport}:${protocol.applicationProtocol}:${protocol.confidence}`;
        const endpointDaily = vendorEndpointDailyMap.get(endpointDailyKey);
        if (endpointDaily) {
          endpointDaily.upload += update.upload;
          endpointDaily.download += update.download;
          endpointDaily.connections += connections;
        } else {
          vendorEndpointDailyMap.set(endpointDailyKey, {
            day, sourceIP, vendorId, endpointType, endpoint,
            transport: protocol.transport, applicationProtocol: protocol.applicationProtocol,
            confidence: protocol.confidence, upload: update.upload, download: update.download,
            connections,
          });
        }
      }
      const observabilityHourlyKey = `${hourKey}:${sourceIP}:${domainPresent}`;
      const observabilityHourly = observabilityHourlyMap.get(observabilityHourlyKey);
      if (observabilityHourly) {
        observabilityHourly.upload += update.upload;
        observabilityHourly.download += update.download;
        observabilityHourly.connections += connections;
      } else {
        observabilityHourlyMap.set(observabilityHourlyKey, {
          hour: hourKey, sourceIP, domainPresent,
          upload: update.upload, download: update.download, connections,
        });
      }
      const observabilityDailyKey = `${day}:${sourceIP}:${domainPresent}`;
      const observabilityDaily = observabilityDailyMap.get(observabilityDailyKey);
      if (observabilityDaily) {
        observabilityDaily.upload += update.upload;
        observabilityDaily.download += update.download;
        observabilityDaily.connections += connections;
      } else {
        observabilityDailyMap.set(observabilityDailyKey, {
          day, sourceIP, domainPresent,
          upload: update.upload, download: update.download, connections,
        });
      }

      if (domainPresent === 1 && vendorClassifier.isUnknown(vendorId)) {
        const registrableDomain = getRegistrableDomain(normalizedDomain);
        if (registrableDomain) {
          const unresolvedKey = `${day}:${sourceIP}:${registrableDomain}`;
          const unresolved = unresolvedDailyMap.get(unresolvedKey);
          if (unresolved) {
            unresolved.upload += update.upload;
            unresolved.download += update.download;
            unresolved.connections += connections;
          } else {
            unresolvedDailyMap.set(unresolvedKey, {
              day, sourceIP, registrableDomain,
              upload: update.upload, download: update.download, connections,
            });
          }
        }
      }

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
          ips = CASE WHEN domain_stats.ips IS NULL THEN @ip WHEN LENGTH(domain_stats.ips) > 4000 THEN domain_stats.ips WHEN INSTR(',' || domain_stats.ips || ',', ',' || @ip || ',') > 0 THEN domain_stats.ips ELSE domain_stats.ips || ',' || @ip END,
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + @count, last_seen = @timestamp,
          rules = CASE WHEN domain_stats.rules IS NULL THEN @rule WHEN LENGTH(domain_stats.rules) > 4000 THEN domain_stats.rules WHEN INSTR(',' || domain_stats.rules || ',', ',' || @rule || ',') > 0 THEN domain_stats.rules ELSE domain_stats.rules || ',' || @rule END,
          chains = CASE WHEN domain_stats.chains IS NULL THEN @chain WHEN LENGTH(domain_stats.chains) > 4000 THEN domain_stats.chains WHEN INSTR(',' || domain_stats.chains || ',', ',' || @chain || ',') > 0 THEN domain_stats.chains ELSE domain_stats.chains || ',' || @chain END
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
          domains = CASE WHEN ip_stats.domains IS NULL THEN @domain WHEN LENGTH(ip_stats.domains) > 4000 THEN ip_stats.domains WHEN INSTR(',' || ip_stats.domains || ',', ',' || @domain || ',') > 0 THEN ip_stats.domains ELSE ip_stats.domains || ',' || @domain END,
          total_upload = total_upload + @upload, total_download = total_download + @download,
          total_connections = total_connections + @count, last_seen = @timestamp,
          chains = CASE WHEN ip_stats.chains IS NULL THEN @chain WHEN LENGTH(ip_stats.chains) > 4000 THEN ip_stats.chains WHEN INSTR(',' || ip_stats.chains || ',', ',' || @chain || ',') > 0 THEN ip_stats.chains ELSE ip_stats.chains || ',' || @chain END,
          rules = CASE WHEN ip_stats.rules IS NULL THEN @rule WHEN LENGTH(ip_stats.rules) > 4000 THEN ip_stats.rules WHEN INSTR(',' || ip_stats.rules || ',', ',' || @rule || ',') > 0 THEN ip_stats.rules ELSE ip_stats.rules || ',' || @rule END
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

    // Sub-transaction 3: Device tables
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

    // Vendor rollups are deliberately core writes: their low cardinality keeps
    // 365-day history practical even when full detail is routed to ClickHouse.
    const txVendor = this.db.transaction(() => {
      const hourlyStmt = this.db.prepare(`
        INSERT INTO vendor_hourly_stats
          (backend_id, hour, source_ip, vendor_id, upload, download, connections)
        VALUES (@backendId, @hour, @sourceIP, @vendorId, @upload, @download, @connections)
        ON CONFLICT(backend_id, hour, source_ip, vendor_id) DO UPDATE SET
          upload = upload + @upload,
          download = download + @download,
          connections = connections + @connections
      `);
      for (const data of vendorHourlyMap.values()) {
        hourlyStmt.run({ backendId, ...data });
      }

      const dailyStmt = this.db.prepare(`
        INSERT INTO vendor_daily_stats
          (backend_id, day, source_ip, vendor_id, upload, download, connections)
        VALUES (@backendId, @day, @sourceIP, @vendorId, @upload, @download, @connections)
        ON CONFLICT(backend_id, day, source_ip, vendor_id) DO UPDATE SET
          upload = upload + @upload,
          download = download + @download,
          connections = connections + @connections
      `);
      for (const data of vendorDailyMap.values()) {
        dailyStmt.run({ backendId, ...data });
      }

      const protocolHourlyStmt = this.db.prepare(`
        INSERT INTO vendor_protocol_hourly_stats
          (backend_id, hour, source_ip, vendor_id, transport, application_protocol, confidence, upload, download, connections)
        VALUES (@backendId, @hour, @sourceIP, @vendorId, @transport, @applicationProtocol, @confidence, @upload, @download, @connections)
        ON CONFLICT(backend_id, hour, source_ip, vendor_id, transport, application_protocol, confidence) DO UPDATE SET
          upload = upload + @upload, download = download + @download, connections = connections + @connections
      `);
      for (const data of vendorProtocolHourlyMap.values()) {
        protocolHourlyStmt.run({ backendId, ...data });
      }

      const protocolDailyStmt = this.db.prepare(`
        INSERT INTO vendor_protocol_daily_stats
          (backend_id, day, source_ip, vendor_id, transport, application_protocol, confidence, upload, download, connections)
        VALUES (@backendId, @day, @sourceIP, @vendorId, @transport, @applicationProtocol, @confidence, @upload, @download, @connections)
        ON CONFLICT(backend_id, day, source_ip, vendor_id, transport, application_protocol, confidence) DO UPDATE SET
          upload = upload + @upload, download = download + @download, connections = connections + @connections
      `);
      for (const data of vendorProtocolDailyMap.values()) {
        protocolDailyStmt.run({ backendId, ...data });
      }

      const endpointHourlyStmt = this.db.prepare(`
        INSERT INTO vendor_endpoint_hourly_stats
          (backend_id, hour, source_ip, vendor_id, endpoint_type, endpoint,
           transport, application_protocol, confidence, upload, download, connections)
        VALUES (@backendId, @hour, @sourceIP, @vendorId, @endpointType, @endpoint,
                @transport, @applicationProtocol, @confidence, @upload, @download, @connections)
        ON CONFLICT(backend_id, hour, source_ip, vendor_id, endpoint_type, endpoint,
                    transport, application_protocol, confidence) DO UPDATE SET
          upload = upload + @upload, download = download + @download,
          connections = connections + @connections
      `);
      for (const data of vendorEndpointHourlyMap.values()) {
        endpointHourlyStmt.run({ backendId, ...data });
      }

      const endpointDailyStmt = this.db.prepare(`
        INSERT INTO vendor_endpoint_daily_stats
          (backend_id, day, source_ip, vendor_id, endpoint_type, endpoint,
           transport, application_protocol, confidence, upload, download, connections)
        VALUES (@backendId, @day, @sourceIP, @vendorId, @endpointType, @endpoint,
                @transport, @applicationProtocol, @confidence, @upload, @download, @connections)
        ON CONFLICT(backend_id, day, source_ip, vendor_id, endpoint_type, endpoint,
                    transport, application_protocol, confidence) DO UPDATE SET
          upload = upload + @upload, download = download + @download,
          connections = connections + @connections
      `);
      for (const data of vendorEndpointDailyMap.values()) {
        endpointDailyStmt.run({ backendId, ...data });
      }

      const observabilityHourlyStmt = this.db.prepare(`
        INSERT INTO traffic_observability_hourly_stats
          (backend_id, hour, source_ip, domain_present, upload, download, connections)
        VALUES (@backendId, @hour, @sourceIP, @domainPresent, @upload, @download, @connections)
        ON CONFLICT(backend_id, hour, source_ip, domain_present) DO UPDATE SET
          upload = upload + @upload, download = download + @download, connections = connections + @connections
      `);
      for (const data of observabilityHourlyMap.values()) {
        observabilityHourlyStmt.run({ backendId, ...data });
      }

      const observabilityDailyStmt = this.db.prepare(`
        INSERT INTO traffic_observability_daily_stats
          (backend_id, day, source_ip, domain_present, upload, download, connections)
        VALUES (@backendId, @day, @sourceIP, @domainPresent, @upload, @download, @connections)
        ON CONFLICT(backend_id, day, source_ip, domain_present) DO UPDATE SET
          upload = upload + @upload, download = download + @download, connections = connections + @connections
      `);
      for (const data of observabilityDailyMap.values()) {
        observabilityDailyStmt.run({ backendId, ...data });
      }

      const unresolvedStmt = this.db.prepare(`
        INSERT INTO unresolved_domain_daily_stats
          (backend_id, day, source_ip, registrable_domain, upload, download, connections)
        VALUES (@backendId, @day, @sourceIP, @registrableDomain, @upload, @download, @connections)
        ON CONFLICT(backend_id, day, source_ip, registrable_domain) DO UPDATE SET
          upload = upload + @upload, download = download + @download, connections = connections + @connections
      `);
      for (const data of unresolvedDailyMap.values()) {
        unresolvedStmt.run({ backendId, ...data });
      }
    });

    // One outer transaction: a mid-flush error rolls back every table, so a
    // retried batch cannot double-count tables that had already committed.
    // (Nested better-sqlite3 transactions become savepoints automatically.)
    const flushAll = this.db.transaction(() => {
      if (reduceWrites) {
        tx1Light();
      } else {
        tx1();
      }
      tx2();
      txVendor();
      if (!reduceWrites) {
        tx3();
      }
    });
    flushAll();
  }
}
