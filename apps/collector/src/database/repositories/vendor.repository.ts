import type Database from 'better-sqlite3';
import type {
  TrafficVendor,
  UnknownVendorCandidate,
  VendorCatalogState,
  VendorDeviceTraffic,
  VendorEndpointStatsResponse,
  VendorEndpointTraffic,
  VendorProtocolTraffic,
  VendorStatsResponse,
  VendorTrafficPoint,
  VendorTrafficTotal,
} from '@neko-master/shared';
import { BaseRepository } from './base.repository.js';
import { normalizeDomain, VendorClassifier } from '../vendor-classifier.js';
import { getRegistrableDomain } from '../registrable-domain.js';

type VendorRow = {
  id: number;
  slug: string;
  name: string;
  color: string;
  priority: number;
  enabled: number;
};

type RuleRow = {
  id: number;
  vendor_id: number;
  pattern: string;
  match_type: 'exact' | 'suffix';
  priority: number;
  source: 'manual' | 'catalog' | 'builtin';
  source_key: string | null;
  source_revision: string | null;
  confidence: 'high' | 'medium' | 'low';
};

type VendorAggregateRow = {
  vendor_id: number;
  vendor_slug: string;
  vendor_name: string;
  color: string;
  source_ip?: string;
  time?: string;
  transport?: VendorProtocolTraffic['transport'];
  application_protocol?: VendorProtocolTraffic['applicationProtocol'];
  confidence?: VendorProtocolTraffic['confidence'];
  upload: number;
  download: number;
  connections: number;
};

type CatalogStateRow = {
  source_key: string;
  source_url: string;
  revision: string | null;
  status: VendorCatalogState['status'];
  rules_count: number;
  conflict_count: number;
  excluded_count: number;
  last_checked_at: string | null;
  last_success_at: string | null;
  error: string | null;
};

export interface VendorInput {
  slug: string;
  name: string;
  color?: string;
  priority?: number;
  enabled?: boolean;
  rules?: Array<{
    pattern: string;
    matchType?: 'exact' | 'suffix';
    priority?: number;
  }>;
}

export interface CatalogRuleInput {
  vendorSlug: string;
  pattern: string;
  matchType: 'exact' | 'suffix';
  priority: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface CatalogSyncResult {
  sourceKey: string;
  sourceUrl: string;
  revision: string;
  etag?: string | null;
  rules: CatalogRuleInput[];
  conflictCount: number;
  excludedCount: number;
}

export interface ReclassificationResult {
  scannedRows: number;
  hourlyRows: number;
  dailyRows: number;
  unresolvedRows: number;
  durationMs: number;
}

export interface IPDomainEnrichment {
  ip: string;
  status: 'resolved' | 'unresolved';
  domain: string | null;
  vendorId: number | null;
  source: 'observed' | 'ptr' | null;
  confidence: 'high' | 'medium' | null;
  evidenceConnections: number;
  evidenceShare: number;
  forwardConfirmed: boolean;
  queriedAt: string;
  expiresAt: string;
}

export interface ObservedIPDomainCandidate {
  domain: string;
  vendorId: number | null;
  connections: number;
  share: number;
}

function mapTotal(row: VendorAggregateRow): VendorTrafficTotal {
  return {
    vendorId: row.vendor_id,
    vendorSlug: row.vendor_slug,
    vendorName: row.vendor_name,
    color: row.color,
    upload: row.upload,
    download: row.download,
    connections: row.connections,
  };
}

function mapCatalogState(row?: CatalogStateRow): VendorCatalogState {
  return {
    sourceKey: row?.source_key ?? 'v2fly',
    sourceUrl: row?.source_url ?? 'https://github.com/v2fly/domain-list-community',
    revision: row?.revision ?? null,
    status: row?.status ?? 'idle',
    rulesCount: row?.rules_count ?? 0,
    conflictCount: row?.conflict_count ?? 0,
    excludedCount: row?.excluded_count ?? 0,
    lastCheckedAt: row?.last_checked_at ?? null,
    lastSuccessAt: row?.last_success_at ?? null,
    error: row?.error ?? null,
  };
}

export class VendorRepository extends BaseRepository {
  constructor(db: Database.Database) {
    super(db);
  }

  getVendors(): TrafficVendor[] {
    const vendors = this.db.prepare(`
      SELECT id, slug, name, color, priority, enabled
      FROM vendors
      ORDER BY priority DESC, name ASC
    `).all() as VendorRow[];
    const rules = this.db.prepare(`
      SELECT id, vendor_id, pattern, match_type, priority,
             source, source_key, source_revision, confidence
      FROM vendor_domain_rules
      ORDER BY priority DESC, LENGTH(pattern) DESC
    `).all() as RuleRow[];
    const byVendor = new Map<number, RuleRow[]>();
    for (const rule of rules) {
      const current = byVendor.get(rule.vendor_id) ?? [];
      current.push(rule);
      byVendor.set(rule.vendor_id, current);
    }
    return vendors.map((vendor) => ({
      id: vendor.id,
      slug: vendor.slug,
      name: vendor.name,
      color: vendor.color,
      priority: vendor.priority,
      enabled: vendor.enabled === 1,
      rules: (byVendor.get(vendor.id) ?? []).map((rule) => ({
        id: rule.id,
        pattern: rule.pattern,
        matchType: rule.match_type,
        priority: rule.priority,
        source: rule.source,
        sourceKey: rule.source_key,
        sourceRevision: rule.source_revision,
        confidence: rule.confidence,
      })),
    }));
  }

  createVendor(input: VendorInput): TrafficVendor {
    const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug || !input.name.trim()) throw new Error('slug and name are required');
    const create = this.db.transaction(() => {
      const result = this.db.prepare(`
        INSERT INTO vendors (slug, name, color, priority, enabled)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        slug,
        input.name.trim(),
        input.color || '#64748b',
        input.priority ?? 0,
        input.enabled === false ? 0 : 1,
      );
      const id = Number(result.lastInsertRowid);
      this.replaceRules(id, input.rules ?? []);
      return id;
    });
    const id = create();
    return this.getVendors().find((vendor) => vendor.id === id)!;
  }

  updateVendor(id: number, input: Partial<VendorInput>): TrafficVendor | undefined {
    const existing = this.getVendors().find((vendor) => vendor.id === id);
    if (!existing) return undefined;
    if (existing.slug === 'unknown' && input.enabled === false) {
      throw new Error('Unknown vendor cannot be disabled');
    }
    const update = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE vendors
        SET name = ?, color = ?, priority = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        input.name?.trim() || existing.name,
        input.color || existing.color,
        input.priority ?? existing.priority,
        input.enabled === undefined ? (existing.enabled ? 1 : 0) : (input.enabled ? 1 : 0),
        id,
      );
      if (input.rules) this.replaceRules(id, input.rules);
    });
    update();
    return this.getVendors().find((vendor) => vendor.id === id);
  }

  private replaceRules(id: number, rules: NonNullable<VendorInput['rules']>): void {
    const normalizedRules = rules.map((rule) => ({
      pattern: normalizeDomain(rule.pattern),
      matchType: rule.matchType ?? ('suffix' as const),
      priority: rule.priority ?? 100,
    })).filter((rule) => !!rule.pattern);
    for (const rule of normalizedRules) {
      const conflict = this.db.prepare(`
        SELECT v.name
        FROM vendor_domain_rules r
        JOIN vendors v ON v.id = r.vendor_id
        WHERE r.source = 'manual' AND r.vendor_id <> ?
          AND r.pattern = ? AND r.match_type = ?
        LIMIT 1
      `).get(id, rule.pattern, rule.matchType) as { name: string } | undefined;
      if (conflict) {
        throw new Error(`Manual rule ${rule.pattern} already belongs to ${conflict.name}`);
      }
    }
    this.db.prepare(`DELETE FROM vendor_domain_rules WHERE vendor_id = ? AND source = 'manual'`).run(id);
    const insert = this.db.prepare(`
      INSERT INTO vendor_domain_rules
        (vendor_id, pattern, match_type, priority, source, confidence)
      VALUES (?, ?, ?, ?, 'manual', 'high')
      ON CONFLICT(vendor_id, pattern, match_type) DO UPDATE SET
        priority = excluded.priority,
        source = 'manual', source_key = NULL, source_revision = NULL,
        confidence = 'high'
    `);
    const seen = new Set<string>();
    for (const rule of normalizedRules) {
      const key = `${rule.matchType}:${rule.pattern}`;
      if (seen.has(key)) continue;
      seen.add(key);
      insert.run(id, rule.pattern, rule.matchType, rule.priority);
    }
  }

  getStats(
    backendId: number,
    start: string,
    end: string,
    sourceIP?: string,
  ): VendorStatsResponse {
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
      throw new Error('Invalid time range');
    }
    const hourlyCutoffMs = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const useDaily = startMs < hourlyCutoffMs;
    const table = useDaily ? 'vendor_daily_stats' : 'vendor_hourly_stats';
    const protocolTable = useDaily ? 'vendor_protocol_daily_stats' : 'vendor_protocol_hourly_stats';
    const observabilityTable = useDaily ? 'traffic_observability_daily_stats' : 'traffic_observability_hourly_stats';
    const timeColumn = useDaily ? 'day' : 'hour';
    const startKey = useDaily ? start.slice(0, 10) : `${start.slice(0, 13)}:00:00`;
    const endKey = useDaily ? end.slice(0, 10) : `${end.slice(0, 13)}:00:00`;
    const sourceFilter = sourceIP ? ' AND s.source_ip = @sourceIP' : '';
    const params = { backendId, start: startKey, end: endKey, sourceIP: sourceIP ?? '' };

    const selectVendor = `
      s.vendor_id, v.slug AS vendor_slug, v.name AS vendor_name, v.color,
      SUM(s.upload) AS upload, SUM(s.download) AS download,
      SUM(s.connections) AS connections
    `;
    const joinsAndWhere = `
      FROM ${table} s
      JOIN vendors v ON v.id = s.vendor_id
      WHERE s.backend_id = @backendId AND s.${timeColumn} BETWEEN @start AND @end${sourceFilter}
    `;

    const totalRows = this.db.prepare(`
      SELECT ${selectVendor}
      ${joinsAndWhere}
      GROUP BY s.vendor_id, v.slug, v.name, v.color
      ORDER BY (SUM(s.upload) + SUM(s.download)) DESC
    `).all(params) as VendorAggregateRow[];

    const deviceRows = this.db.prepare(`
      SELECT ${selectVendor}, s.source_ip
      ${joinsAndWhere} AND s.source_ip <> ''
      GROUP BY s.source_ip, s.vendor_id, v.slug, v.name, v.color
      ORDER BY (SUM(s.upload) + SUM(s.download)) DESC
      LIMIT 500
    `).all(params) as VendorAggregateRow[];

    const trendRows = this.db.prepare(`
      SELECT ${selectVendor}, s.${timeColumn} AS time
      ${joinsAndWhere}
      GROUP BY s.${timeColumn}, s.vendor_id, v.slug, v.name, v.color
      ORDER BY s.${timeColumn} ASC, (SUM(s.upload) + SUM(s.download)) DESC
      LIMIT 20000
    `).all(params) as VendorAggregateRow[];

    const protocolRows = this.db.prepare(`
      SELECT ${selectVendor}, s.transport, s.application_protocol, s.confidence
      FROM ${protocolTable} s
      JOIN vendors v ON v.id = s.vendor_id
      WHERE s.backend_id = @backendId AND s.${timeColumn} BETWEEN @start AND @end${sourceFilter}
      GROUP BY s.vendor_id, v.slug, v.name, v.color, s.transport, s.application_protocol, s.confidence
      ORDER BY (SUM(s.upload) + SUM(s.download)) DESC
    `).all(params) as VendorAggregateRow[];

    const observability = this.db.prepare(`
      SELECT
        COALESCE(SUM(upload + download), 0) AS total,
        COALESCE(SUM(CASE WHEN domain_present = 1 THEN upload + download ELSE 0 END), 0) AS domain_observed
      FROM ${observabilityTable} s
      WHERE s.backend_id = @backendId AND s.${timeColumn} BETWEEN @start AND @end${sourceFilter}
    `).get(params) as { total: number; domain_observed: number };

    const totalTraffic = totalRows.reduce((sum, row) => sum + row.upload + row.download, 0);
    const recognizedTraffic = totalRows
      .filter((row) => row.vendor_slug !== 'unknown')
      .reduce((sum, row) => sum + row.upload + row.download, 0);
    const observedTotal = observability.total || totalTraffic;
    const domainObservedTraffic = observability.total > 0 ? observability.domain_observed : 0;
    const percent = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : 0;

    return {
      granularity: useDaily ? 'day' : 'hour',
      totals: totalRows.map(mapTotal),
      byDevice: deviceRows.map((row): VendorDeviceTraffic => ({
        ...mapTotal(row),
        sourceIP: row.source_ip || '',
      })),
      trend: trendRows.map((row): VendorTrafficPoint => ({
        ...mapTotal(row),
        time: row.time || '',
      })),
      protocols: protocolRows.map((row): VendorProtocolTraffic => ({
        ...mapTotal(row),
        transport: row.transport || 'unknown',
        applicationProtocol: row.application_protocol || 'other',
        confidence: row.confidence || 'unknown',
      })),
      quality: {
        totalTraffic: observedTotal,
        recognizedTraffic,
        domainObservedTraffic,
        totalRecognitionRate: percent(recognizedTraffic, observedTotal),
        domainObservationRate: percent(domainObservedTraffic, observedTotal),
        recognizedDomainRate: percent(recognizedTraffic, domainObservedTraffic),
      },
    };
  }

  getEndpointStats(
    backendId: number,
    vendorId: number,
    start: string,
    end: string,
    sourceIP?: string,
    limit = 10,
  ): VendorEndpointStatsResponse {
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
      throw new Error('Invalid time range');
    }
    const useDaily = endMs - startMs > 48 * 60 * 60 * 1000;
    const table = useDaily ? 'vendor_endpoint_daily_stats' : 'vendor_endpoint_hourly_stats';
    const timeColumn = useDaily ? 'day' : 'hour';
    const startKey = useDaily ? start.slice(0, 10) : `${start.slice(0, 13)}:00:00`;
    const endKey = useDaily ? end.slice(0, 10) : `${end.slice(0, 13)}:00:00`;
    const sourceFilter = sourceIP ? ' AND source_ip = @sourceIP' : '';
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const params = { backendId, vendorId, start: startKey, end: endKey, sourceIP: sourceIP ?? '', limit: safeLimit };
    const topRows = this.db.prepare(`
      SELECT endpoint_type, endpoint,
             SUM(upload) AS upload, SUM(download) AS download,
             SUM(connections) AS connections,
             COUNT(DISTINCT NULLIF(source_ip, '')) AS devices
      FROM ${table}
      WHERE backend_id = @backendId AND vendor_id = @vendorId
        AND ${timeColumn} BETWEEN @start AND @end${sourceFilter}
      GROUP BY endpoint_type, endpoint
      ORDER BY (SUM(upload) + SUM(download)) DESC
      LIMIT @limit
    `).all(params) as Array<{
      endpoint_type: 'domain' | 'ip'; endpoint: string; upload: number;
      download: number; connections: number; devices: number;
    }>;

    const protocolStmt = this.db.prepare(`
      SELECT transport, application_protocol, confidence,
             SUM(upload + download) AS traffic
      FROM ${table}
      WHERE backend_id = @backendId AND vendor_id = @vendorId
        AND endpoint_type = @endpointType AND endpoint = @endpoint
        AND ${timeColumn} BETWEEN @start AND @end${sourceFilter}
      GROUP BY transport, application_protocol, confidence
      ORDER BY traffic DESC
      LIMIT 1
    `);
    const geoStmt = this.db.prepare(`
      SELECT as_name, as_domain, country, country_name, city
      FROM geoip_cache WHERE ip = ? LIMIT 1
    `);
    const enrichmentStmt = this.db.prepare(`
      SELECT e.domain, e.vendor_id, e.source, e.confidence,
             v.name AS vendor_name, v.slug AS vendor_slug
      FROM ip_domain_enrichment_cache e
      LEFT JOIN vendors v ON v.id = e.vendor_id
      WHERE e.ip = ? AND e.status = 'resolved' AND e.expires_at > CURRENT_TIMESTAMP
      LIMIT 1
    `);
    const endpoints = topRows.map((row): VendorEndpointTraffic => {
      const protocol = protocolStmt.get({
        ...params, endpointType: row.endpoint_type, endpoint: row.endpoint,
      }) as {
        transport: VendorEndpointTraffic['transport'];
        application_protocol: VendorEndpointTraffic['applicationProtocol'];
        confidence: VendorEndpointTraffic['confidence'];
        traffic: number;
      } | undefined;
      const geo = row.endpoint_type === 'ip'
        ? geoStmt.get(row.endpoint) as {
          as_name: string | null; as_domain: string | null; country: string | null;
          country_name: string | null; city: string | null;
        } | undefined
        : undefined;
      const enrichment = row.endpoint_type === 'ip'
        ? enrichmentStmt.get(row.endpoint) as {
          domain: string | null; vendor_id: number | null;
          source: 'observed' | 'ptr' | null; confidence: 'high' | 'medium' | null;
          vendor_name: string | null; vendor_slug: string | null;
        } | undefined
        : undefined;
      const total = row.upload + row.download;
      return {
        endpointType: row.endpoint_type,
        endpoint: row.endpoint,
        upload: row.upload,
        download: row.download,
        connections: row.connections,
        devices: row.devices,
        transport: protocol?.transport ?? 'unknown',
        applicationProtocol: protocol?.application_protocol ?? 'other',
        confidence: protocol?.confidence ?? 'unknown',
        protocolShare: total > 0 ? (protocol?.traffic ?? 0) / total : 0,
        networkOwner: geo?.as_name ?? null,
        networkDomain: geo?.as_domain ?? null,
        country: geo?.country ?? null,
        countryName: geo?.country_name ?? null,
        city: geo?.city ?? null,
        resolvedDomain: enrichment?.domain ?? null,
        resolvedVendorId: enrichment?.vendor_id ?? null,
        resolvedVendorName: enrichment?.vendor_name ?? null,
        resolvedVendorSlug: enrichment?.vendor_slug ?? null,
        resolutionSource: enrichment?.source ?? null,
        resolutionConfidence: enrichment?.confidence ?? null,
      };
    });
    return { granularity: useDaily ? 'day' : 'hour', vendorId, endpoints };
  }

  getIPDomainEnrichment(ip: string): IPDomainEnrichment | null {
    const row = this.db.prepare(`
      SELECT ip, status, domain, vendor_id, source, confidence,
             evidence_connections, evidence_share, forward_confirmed,
             queried_at, expires_at
      FROM ip_domain_enrichment_cache
      WHERE ip = ? AND expires_at > CURRENT_TIMESTAMP
    `).get(ip) as {
      ip: string; status: 'resolved' | 'unresolved'; domain: string | null;
      vendor_id: number | null; source: 'observed' | 'ptr' | null;
      confidence: 'high' | 'medium' | null; evidence_connections: number;
      evidence_share: number; forward_confirmed: number;
      queried_at: string; expires_at: string;
    } | undefined;
    if (!row) return null;
    return {
      ip: row.ip,
      status: row.status,
      domain: row.domain,
      vendorId: row.vendor_id,
      source: row.source,
      confidence: row.confidence,
      evidenceConnections: row.evidence_connections,
      evidenceShare: row.evidence_share,
      forwardConfirmed: row.forward_confirmed === 1,
      queriedAt: row.queried_at,
      expiresAt: row.expires_at,
    };
  }

  saveIPDomainEnrichment(input: {
    ip: string;
    status: 'resolved' | 'unresolved';
    domain?: string | null;
    vendorId?: number | null;
    source?: 'observed' | 'ptr' | null;
    confidence?: 'high' | 'medium' | null;
    evidenceConnections?: number;
    evidenceShare?: number;
    forwardConfirmed?: boolean;
    ttlHours: number;
    error?: string | null;
  }): void {
    const queriedAt = new Date();
    const expiresAt = new Date(queriedAt.getTime() + input.ttlHours * 60 * 60 * 1000);
    this.db.prepare(`
      INSERT INTO ip_domain_enrichment_cache
        (ip, status, domain, vendor_id, source, confidence,
         evidence_connections, evidence_share, forward_confirmed,
         queried_at, expires_at, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET
        status = excluded.status, domain = excluded.domain,
        vendor_id = excluded.vendor_id, source = excluded.source,
        confidence = excluded.confidence,
        evidence_connections = excluded.evidence_connections,
        evidence_share = excluded.evidence_share,
        forward_confirmed = excluded.forward_confirmed,
        queried_at = excluded.queried_at, expires_at = excluded.expires_at,
        error = excluded.error
    `).run(
      input.ip, input.status, input.domain ?? null, input.vendorId ?? null,
      input.source ?? null, input.confidence ?? null,
      input.evidenceConnections ?? 0, input.evidenceShare ?? 0,
      input.forwardConfirmed ? 1 : 0,
      queriedAt.toISOString(), expiresAt.toISOString(), input.error?.slice(0, 500) ?? null,
    );
  }

  findObservedIPDomainCandidate(ip: string, days = 30): ObservedIPDomainCandidate | null {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 13) + ':00:00';
    const rows = this.db.prepare(`
      SELECT LOWER(TRIM(domain, '.')) AS domain,
             SUM(upload + download) AS traffic,
             SUM(connections) AS connections
      FROM hourly_dim_stats
      WHERE ip = ? AND hour >= ?
        AND domain <> '' AND LOWER(domain) <> 'unknown'
      GROUP BY LOWER(TRIM(domain, '.'))
      ORDER BY traffic DESC
      LIMIT 100
    `).all(ip, cutoff) as Array<{ domain: string; traffic: number; connections: number }>;
    if (!rows.length) return null;

    const classifier = new VendorClassifier(this.db);
    const vendorTraffic = new Map<number, { traffic: number; connections: number; domain: string; domainTraffic: number }>();
    let totalTraffic = 0;
    for (const row of rows) {
      totalTraffic += row.traffic;
      const vendorId = classifier.classify(row.domain);
      const current = vendorTraffic.get(vendorId);
      if (!current) {
        vendorTraffic.set(vendorId, {
          traffic: row.traffic, connections: row.connections,
          domain: row.domain, domainTraffic: row.traffic,
        });
      } else {
        current.traffic += row.traffic;
        current.connections += row.connections;
        if (row.traffic > current.domainTraffic) {
          current.domain = row.domain;
          current.domainTraffic = row.traffic;
        }
      }
    }
    const best = [...vendorTraffic.entries()].sort((a, b) => b[1].traffic - a[1].traffic)[0];
    if (!best || totalTraffic <= 0) return null;
    const [vendorId, evidence] = best;
    const share = evidence.traffic / totalTraffic;
    if (evidence.connections < 3 || share < 0.8) return null;
    return {
      domain: evidence.domain,
      vendorId: classifier.isUnknown(vendorId) ? null : vendorId,
      connections: evidence.connections,
      share,
    };
  }

  classifyDomain(domain: string): { vendorId: number; unknown: boolean } {
    const classifier = new VendorClassifier(this.db);
    const vendorId = classifier.classify(domain);
    return { vendorId, unknown: classifier.isUnknown(vendorId) };
  }

  getCatalogState(sourceKey = 'v2fly'): VendorCatalogState {
    const row = this.db.prepare(`
      SELECT source_key, source_url, revision, status, rules_count,
             conflict_count, excluded_count, last_checked_at, last_success_at, error
      FROM vendor_catalog_state WHERE source_key = ?
    `).get(sourceKey) as CatalogStateRow | undefined;
    return mapCatalogState(row);
  }

  getBuiltinRulePackVersion(): string | null {
    const row = this.db.prepare(
      `SELECT value FROM app_config WHERE key = 'vendor.builtin_rule_pack_version'`,
    ).get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  markBuiltinRulePackApplied(version: string): void {
    this.db.prepare(`
      INSERT INTO app_config (key, value) VALUES ('vendor.builtin_rule_pack_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(version);
  }

  markCatalogSyncing(sourceKey: string, sourceUrl: string): void {
    this.db.prepare(`
      INSERT INTO vendor_catalog_state (source_key, source_url, status, last_checked_at, error)
      VALUES (?, ?, 'syncing', CURRENT_TIMESTAMP, NULL)
      ON CONFLICT(source_key) DO UPDATE SET
        source_url = excluded.source_url, status = 'syncing',
        last_checked_at = CURRENT_TIMESTAMP, error = NULL
    `).run(sourceKey, sourceUrl);
  }

  markCatalogFailed(sourceKey: string, sourceUrl: string, error: string): void {
    this.db.prepare(`
      INSERT INTO vendor_catalog_state (source_key, source_url, status, last_checked_at, error)
      VALUES (?, ?, 'failed', CURRENT_TIMESTAMP, ?)
      ON CONFLICT(source_key) DO UPDATE SET
        source_url = excluded.source_url, status = 'failed',
        last_checked_at = CURRENT_TIMESTAMP, error = excluded.error
    `).run(sourceKey, sourceUrl, error.slice(0, 1000));
  }

  markCatalogUnchanged(sourceKey: string, sourceUrl: string, revision: string, etag?: string | null): void {
    this.db.prepare(`
      INSERT INTO vendor_catalog_state
        (source_key, source_url, revision, etag, status, last_checked_at, last_success_at, error)
      VALUES (?, ?, ?, ?, 'success', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
      ON CONFLICT(source_key) DO UPDATE SET
        source_url = excluded.source_url, revision = excluded.revision,
        etag = COALESCE(excluded.etag, vendor_catalog_state.etag), status = 'success',
        last_checked_at = CURRENT_TIMESTAMP, last_success_at = CURRENT_TIMESTAMP, error = NULL
    `).run(sourceKey, sourceUrl, revision, etag ?? null);
  }

  applyCatalog(result: CatalogSyncResult): number {
    const apply = this.db.transaction(() => {
      const vendorRows = this.db.prepare(`SELECT id, slug FROM vendors`).all() as Array<{ id: number; slug: string }>;
      const vendorIds = new Map(vendorRows.map((vendor) => [vendor.slug, vendor.id]));
      this.db.prepare(`DELETE FROM vendor_domain_rules WHERE source = 'catalog' AND source_key = ?`).run(result.sourceKey);
      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO vendor_domain_rules
          (vendor_id, pattern, match_type, priority, source, source_key, source_revision, confidence)
        VALUES (?, ?, ?, ?, 'catalog', ?, ?, ?)
      `);
      let inserted = 0;
      for (const rule of result.rules) {
        const vendorId = vendorIds.get(rule.vendorSlug);
        if (!vendorId) continue;
        inserted += insert.run(
          vendorId,
          normalizeDomain(rule.pattern),
          rule.matchType,
          rule.priority,
          result.sourceKey,
          result.revision,
          rule.confidence,
        ).changes;
      }
      this.db.prepare(`
        INSERT INTO vendor_catalog_state
          (source_key, source_url, revision, etag, status, rules_count,
           conflict_count, excluded_count, last_checked_at, last_success_at, error)
        VALUES (?, ?, ?, ?, 'success', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
        ON CONFLICT(source_key) DO UPDATE SET
          source_url = excluded.source_url, revision = excluded.revision,
          etag = excluded.etag, status = 'success', rules_count = excluded.rules_count,
          conflict_count = excluded.conflict_count, excluded_count = excluded.excluded_count,
          last_checked_at = CURRENT_TIMESTAMP, last_success_at = CURRENT_TIMESTAMP, error = NULL
      `).run(
        result.sourceKey,
        result.sourceUrl,
        result.revision,
        result.etag ?? null,
        inserted,
        result.conflictCount,
        result.excludedCount,
      );
      return inserted;
    });
    return apply();
  }

  getUnknownCandidates(backendId: number, days = 30, limit = 30): UnknownVendorCandidate[] {
    const safeDays = Math.max(1, Math.min(365, Math.floor(days)));
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rows = this.db.prepare(`
      SELECT registrable_domain,
             SUM(upload) AS upload,
             SUM(download) AS download,
             SUM(connections) AS connections,
             COUNT(DISTINCT NULLIF(source_ip, '')) AS devices,
             MAX(day) AS last_seen
      FROM unresolved_domain_daily_stats
      WHERE backend_id = ? AND day >= ?
      GROUP BY registrable_domain
      ORDER BY (SUM(upload) + SUM(download)) DESC
      LIMIT ?
    `).all(backendId, cutoff, safeLimit) as Array<{
      registrable_domain: string;
      upload: number;
      download: number;
      connections: number;
      devices: number;
      last_seen: string;
    }>;
    return rows.map((row) => ({
      registrableDomain: row.registrable_domain,
      upload: row.upload,
      download: row.download,
      connections: row.connections,
      devices: row.devices,
      lastSeen: row.last_seen,
    }));
  }

  reclassifyRecentHistory(days = 30): ReclassificationResult {
    const startedAt = Date.now();
    const safeDays = Math.max(1, Math.min(365, Math.floor(days)));
    const cutoff = `${new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}T00:00:00`;
    const rows = this.db.prepare(`
      SELECT backend_id, hour, domain, ip, source_ip, upload, download, connections
      FROM hourly_dim_stats
      WHERE hour >= ?
    `).all(cutoff) as Array<{
      backend_id: number;
      hour: string;
      domain: string;
      ip: string;
      source_ip: string;
      upload: number;
      download: number;
      connections: number;
    }>;
    if (rows.length === 0) {
      return { scannedRows: 0, hourlyRows: 0, dailyRows: 0, unresolvedRows: 0, durationMs: Date.now() - startedAt };
    }

    type StoredProtocol = {
      backend_id: number;
      hour: string;
      source_ip: string;
      endpoint_type: 'domain' | 'ip';
      endpoint: string;
      transport: VendorProtocolTraffic['transport'];
      application_protocol: VendorProtocolTraffic['applicationProtocol'];
      confidence: VendorProtocolTraffic['confidence'];
      traffic: number;
    };
    const storedProtocols = this.db.prepare(`
      SELECT backend_id, hour, source_ip, endpoint_type, endpoint,
             transport, application_protocol, confidence,
             SUM(upload + download) AS traffic
      FROM vendor_endpoint_hourly_stats
      WHERE hour >= ?
      GROUP BY backend_id, hour, source_ip, endpoint_type, endpoint,
               transport, application_protocol, confidence
      ORDER BY traffic DESC
    `).all(cutoff) as StoredProtocol[];
    const protocolByEndpoint = new Map<string, StoredProtocol>();
    for (const protocol of storedProtocols) {
      const key = `${protocol.backend_id}:${protocol.hour}:${protocol.source_ip}:${protocol.endpoint_type}:${protocol.endpoint}`;
      if (!protocolByEndpoint.has(key)) protocolByEndpoint.set(key, protocol);
    }

    const hourlyCutoffByBackend = new Map<number, string>();
    for (const row of rows) {
      const current = hourlyCutoffByBackend.get(row.backend_id);
      if (!current || row.hour < current) hourlyCutoffByBackend.set(row.backend_id, row.hour);
    }
    const dailyCutoffByBackend = new Map<number, string>();
    for (const [backendId, hour] of hourlyCutoffByBackend) {
      const day = hour.slice(0, 10);
      const hasEarlierHourlyAggregate = !hour.endsWith('T00:00:00') && !!this.db.prepare(`
        SELECT 1
        FROM vendor_hourly_stats
        WHERE backend_id = ? AND hour >= ? AND hour < ?
        LIMIT 1
      `).get(backendId, `${day}T00:00:00`, hour);
      if (!hasEarlierHourlyAggregate) {
        dailyCutoffByBackend.set(backendId, day);
        continue;
      }
      const nextDay = new Date(`${day}T00:00:00.000Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      dailyCutoffByBackend.set(backendId, nextDay.toISOString().slice(0, 10));
    }

    const classifier = new VendorClassifier(this.db);
    type Aggregate = {
      backendId: number; time: string; sourceIP: string; vendorId?: number;
      domainPresent?: number; registrableDomain?: string;
      endpointType?: 'domain' | 'ip'; endpoint?: string;
      transport?: VendorProtocolTraffic['transport'];
      applicationProtocol?: VendorProtocolTraffic['applicationProtocol'];
      confidence?: VendorProtocolTraffic['confidence'];
      upload: number; download: number; connections: number;
    };
    const hourly = new Map<string, Aggregate>();
    const daily = new Map<string, Aggregate>();
    const observabilityHourly = new Map<string, Aggregate>();
    const observabilityDaily = new Map<string, Aggregate>();
    const unresolved = new Map<string, Aggregate>();
    const protocolHourly = new Map<string, Aggregate>();
    const protocolDaily = new Map<string, Aggregate>();
    const endpointHourly = new Map<string, Aggregate>();
    const endpointDaily = new Map<string, Aggregate>();
    const add = (map: Map<string, Aggregate>, key: string, value: Aggregate) => {
      const current = map.get(key);
      if (current) {
        current.upload += value.upload;
        current.download += value.download;
        current.connections += value.connections;
      } else {
        map.set(key, value);
      }
    };
    for (const row of rows) {
      const sourceIP = row.source_ip || '';
      const day = row.hour.slice(0, 10);
      const domain = normalizeDomain(row.domain || '');
      const domainPresent = domain && domain !== 'unknown' ? 1 : 0;
      const vendorId = classifier.classify(domain);
      const endpointType: 'domain' | 'ip' = domainPresent === 1 ? 'domain' : 'ip';
      const endpoint = endpointType === 'domain' ? domain : (row.ip || '').trim();
      const storedProtocol = protocolByEndpoint.get(
        `${row.backend_id}:${row.hour}:${sourceIP}:${endpointType}:${endpoint}`,
      );
      const transport = storedProtocol?.transport ?? 'unknown';
      const applicationProtocol = storedProtocol?.application_protocol ?? 'other';
      const confidence = storedProtocol?.confidence ?? 'unknown';
      const base = {
        backendId: row.backend_id, sourceIP, upload: row.upload,
        download: row.download, connections: row.connections,
      };
      add(hourly, `${row.backend_id}:${row.hour}:${sourceIP}:${vendorId}`, { ...base, time: row.hour, vendorId });
      add(observabilityHourly, `${row.backend_id}:${row.hour}:${sourceIP}:${domainPresent}`, { ...base, time: row.hour, domainPresent });
      add(protocolHourly, `${row.backend_id}:${row.hour}:${sourceIP}:${vendorId}:${transport}:${applicationProtocol}:${confidence}`, {
        ...base, time: row.hour, vendorId, transport, applicationProtocol, confidence,
      });
      if (endpoint) {
        add(endpointHourly, `${row.backend_id}:${row.hour}:${sourceIP}:${vendorId}:${endpointType}:${endpoint}:${transport}:${applicationProtocol}:${confidence}`, {
          ...base, time: row.hour, vendorId, endpointType, endpoint, transport, applicationProtocol, confidence,
        });
      }
      const dailyCutoff = dailyCutoffByBackend.get(row.backend_id);
      if (dailyCutoff && day >= dailyCutoff) {
        add(daily, `${row.backend_id}:${day}:${sourceIP}:${vendorId}`, { ...base, time: day, vendorId });
        add(observabilityDaily, `${row.backend_id}:${day}:${sourceIP}:${domainPresent}`, { ...base, time: day, domainPresent });
        add(protocolDaily, `${row.backend_id}:${day}:${sourceIP}:${vendorId}:${transport}:${applicationProtocol}:${confidence}`, {
          ...base, time: day, vendorId, transport, applicationProtocol, confidence,
        });
        if (endpoint) {
          add(endpointDaily, `${row.backend_id}:${day}:${sourceIP}:${vendorId}:${endpointType}:${endpoint}:${transport}:${applicationProtocol}:${confidence}`, {
            ...base, time: day, vendorId, endpointType, endpoint, transport, applicationProtocol, confidence,
          });
        }
        if (domainPresent === 1 && classifier.isUnknown(vendorId)) {
          const registrableDomain = getRegistrableDomain(domain);
          if (registrableDomain) {
            add(unresolved, `${row.backend_id}:${day}:${sourceIP}:${registrableDomain}`, {
              ...base, time: day, registrableDomain,
            });
          }
        }
      }
    }

    const write = this.db.transaction(() => {
      for (const [backendId, hourlyCutoff] of hourlyCutoffByBackend) {
        const dailyCutoff = dailyCutoffByBackend.get(backendId)!;
        this.db.prepare(`DELETE FROM vendor_hourly_stats WHERE backend_id = ? AND hour >= ?`).run(backendId, hourlyCutoff);
        this.db.prepare(`DELETE FROM vendor_daily_stats WHERE backend_id = ? AND day >= ?`).run(backendId, dailyCutoff);
        this.db.prepare(`DELETE FROM traffic_observability_hourly_stats WHERE backend_id = ? AND hour >= ?`).run(backendId, hourlyCutoff);
        this.db.prepare(`DELETE FROM traffic_observability_daily_stats WHERE backend_id = ? AND day >= ?`).run(backendId, dailyCutoff);
        this.db.prepare(`DELETE FROM vendor_protocol_hourly_stats WHERE backend_id = ? AND hour >= ?`).run(backendId, hourlyCutoff);
        this.db.prepare(`DELETE FROM vendor_protocol_daily_stats WHERE backend_id = ? AND day >= ?`).run(backendId, dailyCutoff);
        this.db.prepare(`DELETE FROM unresolved_domain_daily_stats WHERE backend_id = ? AND day >= ?`).run(backendId, dailyCutoff);
        this.db.prepare(`DELETE FROM vendor_endpoint_hourly_stats WHERE backend_id = ? AND hour >= ?`).run(backendId, hourlyCutoff);
        this.db.prepare(`DELETE FROM vendor_endpoint_daily_stats WHERE backend_id = ? AND day >= ?`).run(backendId, dailyCutoff);
      }

      const vendorHourlyStmt = this.db.prepare(`
        INSERT INTO vendor_hourly_stats
          (backend_id, hour, source_ip, vendor_id, upload, download, connections)
        VALUES (@backendId, @time, @sourceIP, @vendorId, @upload, @download, @connections)
      `);
      for (const value of hourly.values()) vendorHourlyStmt.run(value);
      const vendorDailyStmt = this.db.prepare(`
        INSERT INTO vendor_daily_stats
          (backend_id, day, source_ip, vendor_id, upload, download, connections)
        VALUES (@backendId, @time, @sourceIP, @vendorId, @upload, @download, @connections)
      `);
      for (const value of daily.values()) vendorDailyStmt.run(value);
      const observabilityHourlyStmt = this.db.prepare(`
        INSERT INTO traffic_observability_hourly_stats
          (backend_id, hour, source_ip, domain_present, upload, download, connections)
        VALUES (@backendId, @time, @sourceIP, @domainPresent, @upload, @download, @connections)
      `);
      for (const value of observabilityHourly.values()) observabilityHourlyStmt.run(value);
      const observabilityDailyStmt = this.db.prepare(`
        INSERT INTO traffic_observability_daily_stats
          (backend_id, day, source_ip, domain_present, upload, download, connections)
        VALUES (@backendId, @time, @sourceIP, @domainPresent, @upload, @download, @connections)
      `);
      for (const value of observabilityDaily.values()) observabilityDailyStmt.run(value);
      const protocolHourlyStmt = this.db.prepare(`
        INSERT INTO vendor_protocol_hourly_stats
          (backend_id, hour, source_ip, vendor_id, transport, application_protocol,
           confidence, upload, download, connections)
        VALUES (@backendId, @time, @sourceIP, @vendorId, @transport,
                @applicationProtocol, @confidence, @upload, @download, @connections)
      `);
      for (const value of protocolHourly.values()) protocolHourlyStmt.run(value);
      const protocolDailyStmt = this.db.prepare(`
        INSERT INTO vendor_protocol_daily_stats
          (backend_id, day, source_ip, vendor_id, transport, application_protocol,
           confidence, upload, download, connections)
        VALUES (@backendId, @time, @sourceIP, @vendorId, @transport,
                @applicationProtocol, @confidence, @upload, @download, @connections)
      `);
      for (const value of protocolDaily.values()) protocolDailyStmt.run(value);
      const unresolvedStmt = this.db.prepare(`
        INSERT INTO unresolved_domain_daily_stats
          (backend_id, day, source_ip, registrable_domain, upload, download, connections)
        VALUES (@backendId, @time, @sourceIP, @registrableDomain, @upload, @download, @connections)
      `);
      for (const value of unresolved.values()) unresolvedStmt.run(value);
      const endpointHourlyStmt = this.db.prepare(`
        INSERT INTO vendor_endpoint_hourly_stats
          (backend_id, hour, source_ip, vendor_id, endpoint_type, endpoint,
           transport, application_protocol, confidence, upload, download, connections)
        VALUES (@backendId, @time, @sourceIP, @vendorId, @endpointType, @endpoint,
                @transport, @applicationProtocol, @confidence, @upload, @download, @connections)
      `);
      for (const value of endpointHourly.values()) endpointHourlyStmt.run(value);
      const endpointDailyStmt = this.db.prepare(`
        INSERT INTO vendor_endpoint_daily_stats
          (backend_id, day, source_ip, vendor_id, endpoint_type, endpoint,
           transport, application_protocol, confidence, upload, download, connections)
        VALUES (@backendId, @time, @sourceIP, @vendorId, @endpointType, @endpoint,
                @transport, @applicationProtocol, @confidence, @upload, @download, @connections)
      `);
      for (const value of endpointDaily.values()) endpointDailyStmt.run(value);
    });
    write();
    return {
      scannedRows: rows.length,
      hourlyRows: hourly.size,
      dailyRows: daily.size,
      unresolvedRows: unresolved.size,
      durationMs: Date.now() - startedAt,
    };
  }

  deleteOldHourlyStats(cutoff: string): number {
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

  deleteOldEndpointHourlyStats(cutoff: string): number {
    return this.db.prepare(`DELETE FROM vendor_endpoint_hourly_stats WHERE hour < ?`).run(cutoff).changes;
  }
}
