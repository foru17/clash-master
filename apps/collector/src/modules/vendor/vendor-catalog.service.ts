import {
  buildGatewayHeaders,
  getGatewayBaseUrl,
  isAgentBackendUrl,
  type GatewaySnifferStatus,
  type VendorAutomationResponse,
} from '@neko-master/shared';
import type { StatsDatabase } from '../db/db.js';
import type {
  CatalogRuleInput,
  ReclassificationResult,
} from '../../database/repositories/vendor.repository.js';
import { normalizeDomain } from '../../database/vendor-classifier.js';

const SOURCE_KEY = 'v2fly';
const SOURCE_URL = 'https://github.com/v2fly/domain-list-community';
const COMMIT_URL = 'https://api.github.com/repos/v2fly/domain-list-community/commits/master';
const RAW_BASE_URL = 'https://raw.githubusercontent.com/v2fly/domain-list-community';
const BUILTIN_RULE_PACK_VERSION = '2026-08-13.3';

export const VENDOR_CATALOG_MAPPINGS: Record<string, string[]> = {
  apple: ['apple'],
  google: ['google'],
  microsoft: ['microsoft'],
  tencent: ['tencent', 'dnspod'],
  alibaba: ['alibaba'],
  bytedance: ['bytedance'],
  amazon: ['amazon'],
  meta: ['facebook', 'instagram', 'whatsapp'],
  openai: ['openai'],
  cloudflare: ['cloudflare'],
  xiaomi: ['xiaomi'],
  bilibili: ['bilibili'],
  netflix: ['netflix'],
  qnap: ['qnap'],
  wangsu: ['wangsu'],
  midea: ['midea'],
  netease: ['netease'],
  akamai: ['akamai'],
  fastly: ['fastly'],
  kingsoft: ['kingsoft'],
  baishancloud: ['baishancloud'],
  baidu: ['baidu'],
};

type FetchLike = typeof fetch;
type ParsedDomainRule = { pattern: string; matchType: 'exact' | 'suffix' };
type ParsedCatalog = {
  rules: CatalogRuleInput[];
  conflictCount: number;
  excludedCount: number;
};

function parseLine(line: string):
  | { kind: 'include'; value: string }
  | { kind: 'rule'; pattern: string; matchType: 'exact' | 'suffix' }
  | { kind: 'skip' } {
  const clean = line.split('#', 1)[0].trim();
  if (!clean) return { kind: 'skip' };
  const token = clean.split(/\s+/, 1)[0];
  if (token.startsWith('include:')) {
    const value = token.slice('include:'.length).trim();
    return value ? { kind: 'include', value } : { kind: 'skip' };
  }
  if (token.startsWith('regexp:') || token.startsWith('keyword:')) {
    return { kind: 'skip' };
  }
  const matchType = token.startsWith('full:') ? 'exact' : 'suffix';
  const rawPattern = token.replace(/^(full|domain):/, '');
  const pattern = normalizeDomain(rawPattern);
  if (!pattern || pattern.includes('*') || !pattern.includes('.')) return { kind: 'skip' };
  return { kind: 'rule', pattern, matchType };
}

export async function loadV2FlyCatalog(
  revision: string,
  fetchImpl: FetchLike = fetch,
): Promise<ParsedCatalog> {
  const categoryCache = new Map<string, Promise<ParsedDomainRule[]>>();
  let unsupportedCount = 0;

  const loadCategory = (category: string): Promise<ParsedDomainRule[]> => {
    const normalizedCategory = category.trim().toLowerCase();
    const cached = categoryCache.get(normalizedCategory);
    if (cached) return cached;
    const pending: Promise<ParsedDomainRule[]> = (async (): Promise<ParsedDomainRule[]> => {
      const response = await fetchImpl(
        `${RAW_BASE_URL}/${revision}/data/${encodeURIComponent(normalizedCategory)}`,
        { headers: { 'User-Agent': 'neko-master-home-vendor-catalog' }, signal: AbortSignal.timeout(20_000) },
      );
      if (!response.ok) {
        throw new Error(`V2Fly category ${normalizedCategory} returned HTTP ${response.status}`);
      }
      const ownRules: ParsedDomainRule[] = [];
      const includes: string[] = [];
      for (const line of (await response.text()).split(/\r?\n/)) {
        const parsed = parseLine(line);
        if (parsed.kind === 'include') includes.push(parsed.value);
        else if (parsed.kind === 'rule') ownRules.push(parsed);
        else if (line.trim() && !line.trim().startsWith('#')) unsupportedCount += 1;
      }
      const includedRules: ParsedDomainRule[][] = await Promise.all(
        includes.map((included): Promise<ParsedDomainRule[]> => loadCategory(included)),
      );
      return ownRules.concat(...includedRules);
    })();
    categoryCache.set(normalizedCategory, pending);
    return pending;
  };

  const candidates: CatalogRuleInput[] = [];
  await Promise.all(Object.entries(VENDOR_CATALOG_MAPPINGS).map(async ([vendorSlug, categories]) => {
    const categoryRules = await Promise.all(categories.map((category) => loadCategory(category)));
    for (const rule of categoryRules.flat()) {
      candidates.push({
        vendorSlug,
        pattern: rule.pattern,
        matchType: rule.matchType,
        priority: 10,
        confidence: 'high',
      });
    }
  }));

  const owners = new Map<string, Set<string>>();
  for (const rule of candidates) {
    const key = `${rule.matchType}:${rule.pattern}`;
    const values = owners.get(key) ?? new Set<string>();
    values.add(rule.vendorSlug);
    owners.set(key, values);
  }
  const conflictKeys = new Set(
    [...owners.entries()].filter(([, vendors]) => vendors.size > 1).map(([key]) => key),
  );
  const deduped = new Map<string, CatalogRuleInput>();
  let excludedByConflict = 0;
  for (const rule of candidates) {
    const ruleKey = `${rule.matchType}:${rule.pattern}`;
    if (conflictKeys.has(ruleKey)) {
      excludedByConflict += 1;
      continue;
    }
    deduped.set(`${rule.vendorSlug}:${ruleKey}`, rule);
  }
  return {
    rules: [...deduped.values()],
    conflictCount: conflictKeys.size,
    excludedCount: unsupportedCount + excludedByConflict,
  };
}

export interface CatalogSyncSummary {
  changed: boolean;
  revision: string;
  rulesCount: number;
  conflictCount: number;
  excludedCount: number;
  reclassification: ReclassificationResult | null;
}

export class VendorCatalogService {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<CatalogSyncSummary> | null = null;

  constructor(
    private readonly db: StatsDatabase,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  start(): void {
    this.applyBuiltinRulePack();
    if (process.env.VENDOR_CATALOG_AUTO_UPDATE === '0') return;
    const intervalHours = Math.max(
      1,
      Number.parseInt(process.env.VENDOR_CATALOG_INTERVAL_HOURS || '24', 10) || 24,
    );
    const intervalMs = intervalHours * 60 * 60 * 1000;
    const state = this.db.repos.vendor.getCatalogState();
    const lastSuccessMs = state.lastSuccessAt ? Date.parse(state.lastSuccessAt) : 0;
    if (state.status !== 'success' || !lastSuccessMs || Date.now() - lastSuccessMs >= intervalMs) {
      void this.syncNow(false).catch((error) => {
        console.warn('[VendorCatalog] Initial sync failed; keeping last-known-good rules:', error);
      });
    }
    this.timer = setInterval(() => {
      void this.syncNow(false).catch((error) => {
        console.warn('[VendorCatalog] Scheduled sync failed; keeping last-known-good rules:', error);
      });
    }, intervalMs);
  }

  private applyBuiltinRulePack(): void {
    if (this.db.repos.vendor.getBuiltinRulePackVersion() === BUILTIN_RULE_PACK_VERSION) return;
    const backfillDays = Math.max(
      1,
      Math.min(
        365,
        Number.parseInt(
          process.env.VENDOR_BUILTIN_BACKFILL_DAYS || process.env.VENDOR_CATALOG_BACKFILL_DAYS || '30',
          10,
        ) || 30,
      ),
    );
    try {
      const reclassification = this.db.repos.vendor.reclassifyRecentHistory(backfillDays);
      this.db.repos.vendor.markBuiltinRulePackApplied(BUILTIN_RULE_PACK_VERSION);
      console.info(
        `[VendorCatalog] Applied built-in rule pack ${BUILTIN_RULE_PACK_VERSION}; reclassified ${reclassification.scannedRows} rows in ${reclassification.durationMs}ms`,
      );
    } catch (error) {
      console.warn('[VendorCatalog] Built-in rule pack reclassification failed; will retry on restart:', error);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  syncNow(force = true): Promise<CatalogSyncSummary> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performSync(force).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async performSync(force: boolean): Promise<CatalogSyncSummary> {
    this.db.repos.vendor.markCatalogSyncing(SOURCE_KEY, SOURCE_URL);
    try {
      const commitResponse = await this.fetchImpl(COMMIT_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'neko-master-home-vendor-catalog',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!commitResponse.ok) throw new Error(`GitHub commit API returned HTTP ${commitResponse.status}`);
      const commit = await commitResponse.json() as { sha?: string };
      const revision = commit.sha?.trim();
      if (!revision) throw new Error('GitHub commit API did not return a revision');
      const etag = commitResponse.headers.get('etag');
      const previous = this.db.repos.vendor.getCatalogState();
      if (!force && previous.revision === revision && previous.rulesCount > 0) {
        this.db.repos.vendor.markCatalogUnchanged(SOURCE_KEY, SOURCE_URL, revision, etag);
        return {
          changed: false,
          revision,
          rulesCount: previous.rulesCount,
          conflictCount: previous.conflictCount,
          excludedCount: previous.excludedCount,
          reclassification: null,
        };
      }

      const catalog = await loadV2FlyCatalog(revision, this.fetchImpl);
      const inserted = this.db.repos.vendor.applyCatalog({
        sourceKey: SOURCE_KEY,
        sourceUrl: SOURCE_URL,
        revision,
        etag,
        ...catalog,
      });
      const backfillDays = Math.max(
        1,
        Number.parseInt(process.env.VENDOR_CATALOG_BACKFILL_DAYS || '30', 10) || 30,
      );
      const reclassification = this.db.repos.vendor.reclassifyRecentHistory(backfillDays);
      console.info(
        `[VendorCatalog] Applied ${inserted} rules at ${revision.slice(0, 12)}; reclassified ${reclassification.scannedRows} rows in ${reclassification.durationMs}ms`,
      );
      return {
        changed: true,
        revision,
        rulesCount: inserted,
        conflictCount: catalog.conflictCount,
        excludedCount: catalog.excludedCount,
        reclassification,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.repos.vendor.markCatalogFailed(SOURCE_KEY, SOURCE_URL, message);
      throw error;
    }
  }

  async getAutomation(backendId: number): Promise<VendorAutomationResponse> {
    return {
      catalog: this.db.repos.vendor.getCatalogState(),
      unknownCandidates: this.db.repos.vendor.getUnknownCandidates(backendId),
      sniffer: await this.getSnifferStatus(backendId),
    };
  }

  private async getSnifferStatus(backendId: number): Promise<GatewaySnifferStatus> {
    const backend = this.db.getBackend(backendId);
    if (!backend) throw new Error('Backend not found');
    if (backend.type !== 'clash' || isAgentBackendUrl(backend.url)) {
      return {
        supported: false,
        enabled: null,
        backendType: backend.type,
        message: '当前后端不支持通过 Clash API 检测 sniffer。',
      };
    }
    try {
      const response = await this.fetchImpl(`${getGatewayBaseUrl(backend.url)}/configs`, {
        headers: buildGatewayHeaders(backend),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const config = await response.json() as Record<string, unknown>;
      const nested = typeof config.sniffer === 'object' && config.sniffer
        ? config.sniffer as Record<string, unknown>
        : undefined;
      const raw = config.sniffing ?? nested?.enable;
      const enabled = typeof raw === 'boolean' ? raw : null;
      return {
        supported: enabled !== null,
        enabled,
        backendType: 'clash',
        message: enabled === true
          ? 'OpenClash sniffer 已启用。'
          : enabled === false
            ? 'OpenClash sniffer 未启用；当前协议由传输层和端口推断。'
            : '当前 Clash 内核未返回可识别的 sniffer 状态。',
      };
    } catch (error) {
      return {
        supported: false,
        enabled: null,
        backendType: 'clash',
        message: `无法读取 OpenClash sniffer 状态：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
