import type { StatsDatabase } from '../db/db.js';
import type { BackendConfig } from '../db/db.js';
import type { VendorIPEnrichmentService } from './vendor-ip-enrichment.service.js';
import {
  VendorDomainEvidenceService,
  type DomainEvidence,
} from './vendor-domain-evidence.service.js';
import { VendorSuggestionService } from './vendor-suggestion.service.js';
import type {
  ApplySuggestionResult,
  UnknownDomainSubject,
  VendorSuggestionRecord,
} from '../../database/repositories/vendor.repository.js';

export interface VendorAutomationRunSummary {
  backends: number;
  domainSubjects: number;
  ipSubjects: number;
  suggestionsCreated: number;
  suggestionsUpdated: number;
  autoApplied: number;
  autoApplyFailed: number;
  reclassification: {
    scannedRows: number;
    durationMs: number;
  } | null;
  durationMs: number;
}

const DEFAULT_INTERVAL_HOURS = 6;
const DEFAULT_DOMAIN_LIMIT = 50;
const DEFAULT_IP_LIMIT = 200;
const DEFAULT_MIN_TRAFFIC_BYTES = 1_048_576;
const DEFAULT_EVIDENCE_TTL_HOURS = 168;

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

function envInt(name: string, defaultValue: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, parsed));
}

export class VendorAutomationService {
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<VendorAutomationRunSummary> | null = null;
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly domainLimit: number;
  private readonly ipLimit: number;
  private readonly minTrafficBytes: number;
  private readonly evidenceTtlHours: number;
  private readonly httpProbe: boolean;
  private readonly rdapProbe: boolean;
  private readonly autoApply: boolean;
  private nextRunAt: string | null = null;

  constructor(
    private readonly db: StatsDatabase,
    private readonly ipEnrichmentService?: VendorIPEnrichmentService,
    private readonly evidenceService: VendorDomainEvidenceService = new VendorDomainEvidenceService(),
    private readonly suggestionService: VendorSuggestionService = new VendorSuggestionService(db),
  ) {
    const showcaseMode = envFlag('SHOWCASE_SITE_MODE', false);
    this.enabled = envFlag('VENDOR_AUTOMATION_ENABLED', true) && !showcaseMode;
    this.intervalMs = envInt('VENDOR_AUTOMATION_INTERVAL_HOURS', DEFAULT_INTERVAL_HOURS, 1, 168)
      * 60 * 60 * 1000;
    this.domainLimit = envInt('VENDOR_AUTOMATION_DOMAIN_LIMIT', DEFAULT_DOMAIN_LIMIT, 1, 200);
    this.ipLimit = envInt('VENDOR_AUTOMATION_IP_LIMIT', DEFAULT_IP_LIMIT, 1, 1000);
    this.minTrafficBytes = envInt(
      'VENDOR_AUTOMATION_MIN_TRAFFIC_BYTES',
      DEFAULT_MIN_TRAFFIC_BYTES,
      0,
      1_000_000_000,
    );
    this.evidenceTtlHours = envInt(
      'VENDOR_AUTOMATION_EVIDENCE_TTL_HOURS',
      DEFAULT_EVIDENCE_TTL_HOURS,
      1,
      24 * 30,
    );
    this.httpProbe = envFlag('VENDOR_AUTOMATION_HTTP_PROBE', true);
    this.rdapProbe = envFlag('VENDOR_AUTOMATION_RDAP_PROBE', true);
    this.autoApply = envFlag('VENDOR_AUTOMATION_AUTO_APPLY', true);
  }

  start(): void {
    if (this.timer) return;
    if (!this.enabled) {
      this.nextRunAt = null;
      this.db.repos.vendor.markAutomationDisabled();
      return;
    }
    const firstDelay = 15_000;
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.runNow().catch(() => undefined);
    }, firstDelay);
    this.initialTimer.unref?.();
    this.timer = setInterval(() => {
      void this.runNow().catch(() => undefined);
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  runNow(): Promise<VendorAutomationRunSummary> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performRun().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async performRun(): Promise<VendorAutomationRunSummary> {
    const startedAt = Date.now();
    if (!this.enabled) {
      this.nextRunAt = null;
      this.db.repos.vendor.markAutomationDisabled();
      return {
        backends: 0,
        domainSubjects: 0,
        ipSubjects: 0,
        suggestionsCreated: 0,
        suggestionsUpdated: 0,
        autoApplied: 0,
        autoApplyFailed: 0,
        reclassification: null,
        durationMs: 0,
      };
    }

    this.nextRunAt = new Date(Date.now() + this.intervalMs).toISOString();
    this.db.repos.vendor.markAutomationRunStart(this.nextRunAt);
    const summary: VendorAutomationRunSummary = {
      backends: 0,
      domainSubjects: 0,
      ipSubjects: 0,
      suggestionsCreated: 0,
      suggestionsUpdated: 0,
      autoApplied: 0,
      autoApplyFailed: 0,
      reclassification: null,
      durationMs: 0,
    };

    try {
      const backends = this.db.getAllBackends();
      summary.backends = backends.length;
      for (const backend of backends) {
        await this.processBackend(backend, summary);
      }
      this.db.repos.vendor.pruneExpiredEvidence();
      if (summary.autoApplied > 0) {
        const reclassification = this.db.repos.vendor.reclassifyRecentHistory(30);
        summary.reclassification = {
          scannedRows: reclassification.scannedRows,
          durationMs: reclassification.durationMs,
        };
      }
      summary.durationMs = Date.now() - startedAt;
      this.db.repos.vendor.markAutomationRunFinished(
        'success',
        summary.durationMs,
        null,
        this.nextRunAt,
      );
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.durationMs = Date.now() - startedAt;
      this.db.repos.vendor.markAutomationRunFinished(
        'failed',
        summary.durationMs,
        message,
        this.nextRunAt,
      );
      console.warn('[VendorAutomation] Run failed:', error);
      return summary;
    }
  }

  private async processBackend(
    backend: BackendConfig,
    summary: VendorAutomationRunSummary,
  ): Promise<void> {
    const domainSubjects = this.db.repos.vendor.getTopUnknownDomainSubjects(
      backend.id,
      30,
      this.domainLimit,
      this.minTrafficBytes,
    );
    summary.domainSubjects += domainSubjects.length;
    await this.mapWithConcurrency(domainSubjects, 4, (subject) =>
      this.processDomainSubject(backend.id, subject, summary),
    );

    const ipSubjects = this.db.repos.vendor.getTopUnknownIPSubjects(
      backend.id,
      7,
      this.ipLimit,
    );
    summary.ipSubjects += ipSubjects.length;
    this.ipEnrichmentService?.prepare(ipSubjects.map((subject) => subject.endpoint));
    for (const subject of ipSubjects) {
      const enrichment = this.db.repos.vendor.getIPDomainEnrichment(subject.endpoint);
      if (!enrichment) continue;
      this.db.repos.vendor.saveEvidence({
        backendId: backend.id,
        subjectType: 'ip',
        subject: subject.endpoint,
        evidenceType: enrichment.source ?? 'observed',
        evidenceJson: JSON.stringify({
          status: enrichment.status,
          domain: enrichment.domain,
          vendorId: enrichment.vendorId,
          confidence: enrichment.confidence,
          forwardConfirmed: enrichment.forwardConfirmed,
          evidenceConnections: enrichment.evidenceConnections,
          evidenceShare: enrichment.evidenceShare,
        }),
        trafficBytes: subject.upload + subject.download,
        devices: subject.devices,
        ttlHours: this.evidenceTtlHours,
      });
    }
  }

  private async processDomainSubject(
    backendId: number,
    subject: UnknownDomainSubject,
    summary: VendorAutomationRunSummary,
  ): Promise<void> {
    const latestEvidenceAt = this.db.repos.vendor.getLatestEvidenceAt(
      backendId,
      'domain',
      subject.registrableDomain,
    );
    if (latestEvidenceAt) {
      const elapsed = Date.now() - Date.parse(latestEvidenceAt);
      if (Number.isFinite(elapsed) && elapsed < this.evidenceTtlHours * 60 * 60 * 1000) {
        return;
      }
    }

    const trafficBytes = subject.upload + subject.download;
    let evidence: DomainEvidence;
    try {
      evidence = await this.evidenceService.collect(subject.registrableDomain, {
        http: this.httpProbe,
        rdap: this.rdapProbe,
      });
    } catch {
      return;
    }

    this.saveDomainEvidence(backendId, subject, evidence);
    const suggestions = this.suggestionService.scoreDomainEvidence(
      subject.registrableDomain,
      evidence,
    );
    const best = suggestions[0];
    if (!best) return;

    const result = this.db.repos.vendor.upsertSuggestion({
      backendId,
      subjectType: 'domain',
      subject: subject.registrableDomain,
      suggestedVendorId: best.vendorId,
      confidence: best.confidence,
      score: best.score,
      reasons: best.reasons,
      trafficBytes,
      devices: subject.devices,
    });
    if (result.created) summary.suggestionsCreated += 1;
    else summary.suggestionsUpdated += 1;

    if (!this.autoApply || !this.suggestionService.shouldAutoApply(suggestions)) return;
    const pending = this.db.repos.vendor.getPendingSuggestionForSubject(
      backendId,
      'domain',
      subject.registrableDomain,
    );
    if (!pending) return;
    try {
      const applied = this.db.repos.vendor.applySuggestionAsManualRule(pending.id, 'auto_apply');
      summary.autoApplied += 1;
      console.info(
        `[VendorAutomation] Auto-applied ${applied.pattern} → vendor ${applied.vendorId}`,
      );
    } catch (error) {
      summary.autoApplyFailed += 1;
      console.warn(
        `[VendorAutomation] Auto-apply failed for ${subject.registrableDomain}:`,
        error,
      );
    }
  }

  private saveDomainEvidence(
    backendId: number,
    subject: UnknownDomainSubject,
    evidence: DomainEvidence,
  ): void {
    const trafficBytes = subject.upload + subject.download;
    this.db.repos.vendor.saveEvidence({
      backendId,
      subjectType: 'domain',
      subject: subject.registrableDomain,
      evidenceType: 'dns',
      evidenceJson: JSON.stringify(evidence.dns),
      trafficBytes,
      devices: subject.devices,
      ttlHours: this.evidenceTtlHours,
    });
    if (evidence.dns.cnameChain.length > 0) {
      this.db.repos.vendor.saveEvidence({
        backendId,
        subjectType: 'domain',
        subject: subject.registrableDomain,
        evidenceType: 'cname',
        evidenceJson: JSON.stringify({ cnameChain: evidence.dns.cnameChain }),
        trafficBytes,
        devices: subject.devices,
        ttlHours: this.evidenceTtlHours,
      });
    }
    this.db.repos.vendor.saveEvidence({
      backendId,
      subjectType: 'domain',
      subject: subject.registrableDomain,
      evidenceType: 'http',
      evidenceJson: JSON.stringify(evidence.http),
      trafficBytes,
      devices: subject.devices,
      ttlHours: this.evidenceTtlHours,
    });
    this.db.repos.vendor.saveEvidence({
      backendId,
      subjectType: 'domain',
      subject: subject.registrableDomain,
      evidenceType: 'rdap',
      evidenceJson: JSON.stringify(evidence.rdap),
      trafficBytes,
      devices: subject.devices,
      ttlHours: this.evidenceTtlHours,
    });
  }

  getEvidenceStats(backendId?: number): {
    status: 'idle' | 'running' | 'success' | 'failed' | 'disabled';
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    nextRunAt: string | null;
    lastRunDurationMs: number | null;
    lastError: string | null;
    collectedDomainCount: number;
    collectedIPCount: number;
    pendingSuggestionCount: number;
  } {
    const state = this.db.repos.vendor.getAutomationState();
    const counts = this.db.repos.vendor.getFreshEvidenceCounts(backendId);
    return {
      status: this.enabled ? state.status : 'disabled',
      lastRunAt: state.lastRunAt,
      lastSuccessAt: state.lastSuccessAt,
      nextRunAt: this.enabled ? (this.nextRunAt ?? state.nextRunAt) : null,
      lastRunDurationMs: state.lastRunDurationMs,
      lastError: state.lastError,
      collectedDomainCount: counts.domainCount,
      collectedIPCount: counts.ipCount,
      pendingSuggestionCount: this.db.repos.vendor.countSuggestionsByStatus('pending', backendId),
    };
  }

  getSuggestions(backendId?: number, status: 'pending' | 'applied' | 'dismissed' | 'stale' = 'pending', limit = 100): VendorSuggestionRecord[] {
    return this.db.repos.vendor.getSuggestions(backendId, status, limit);
  }

  applySuggestion(id: number): { applied: ApplySuggestionResult; reclassification: { scannedRows: number; durationMs: number } } {
    const applied = this.db.repos.vendor.applySuggestionAsManualRule(id, 'apply');
    const reclassification = this.db.repos.vendor.reclassifyRecentHistory(30);
    return {
      applied,
      reclassification: {
        scannedRows: reclassification.scannedRows,
        durationMs: reclassification.durationMs,
      },
    };
  }

  dismissSuggestion(id: number): boolean {
    return this.db.repos.vendor.dismissSuggestion(id);
  }

  private async mapWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(items[index]);
      }
    });
    await Promise.all(workers);
  }
}
