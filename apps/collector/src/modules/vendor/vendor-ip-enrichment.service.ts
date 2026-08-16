import { isIP } from 'node:net';
import * as dnsPromises from 'node:dns/promises';
import type { StatsDatabase } from '../db/db.js';
import type { GeoIPService } from '../geo/geo.service.js';
import { normalizeDomain } from '../../database/vendor-classifier.js';

interface ReverseDNSResolver {
  reverse(ip: string): Promise<string[]>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
}

const RESOLVED_TTL_HOURS = 7 * 24;
const UNRESOLVED_TTL_HOURS = 24;
const DNS_TIMEOUT_MS = 3000;

export class VendorIPEnrichmentService {
  private readonly pending = new Set<string>();
  private stopping = false;

  constructor(
    private readonly db: StatsDatabase,
    private readonly geoService?: Pick<GeoIPService, 'getGeoLocation'>,
    private readonly resolver: ReverseDNSResolver = dnsPromises,
  ) {}

  /**
   * Resolve local observations synchronously so they are visible in the
   * current response. PTR and GeoIP lookups continue in the background.
   */
  stop(): void {
    this.stopping = true;
  }

  prepare(ips: string[]): boolean {
    if (this.stopping) return false;
    let changed = false;
    for (const ip of [...new Set(ips)]) {
      if (!isIP(ip) || this.db.repos.vendor.getIPDomainEnrichment(ip)) continue;
      const observed = this.db.repos.vendor.findObservedIPDomainCandidate(ip);
      if (observed) {
        this.db.repos.vendor.saveIPDomainEnrichment({
          ip,
          status: 'resolved',
          domain: observed.domain,
          vendorId: observed.vendorId,
          source: 'observed',
          confidence: 'high',
          evidenceConnections: observed.connections,
          evidenceShare: observed.share,
          ttlHours: RESOLVED_TTL_HOURS,
        });
        changed = true;
        continue;
      }
      this.schedulePTR(ip);
    }
    return changed;
  }

  private schedulePTR(ip: string): void {
    if (this.stopping || this.pending.has(ip)) return;
    this.pending.add(ip);
    void this.resolvePTR(ip).finally(() => this.pending.delete(ip));
    if (this.geoService) {
      void this.geoService.getGeoLocation(ip).catch(() => null);
    }
  }

  private async resolvePTR(ip: string): Promise<void> {
    try {
      const names = await this.withTimeout(this.resolver.reverse(ip));
      for (const rawName of names.slice(0, 10)) {
        if (this.stopping) return;
        const domain = normalizeDomain(rawName);
        if (!domain || domain.length > 253 || !domain.includes('.')) continue;
        const addresses = await this.forwardAddresses(domain, isIP(ip));
        if (this.stopping) return;
        if (!addresses.includes(ip)) continue;

        const classification = this.db.repos.vendor.classifyDomain(domain);
        this.db.repos.vendor.saveIPDomainEnrichment({
          ip,
          status: 'resolved',
          domain,
          vendorId: classification.unknown ? null : classification.vendorId,
          source: 'ptr',
          confidence: 'high',
          forwardConfirmed: true,
          ttlHours: RESOLVED_TTL_HOURS,
        });
        return;
      }
      this.saveUnresolved(ip, 'No forward-confirmed PTR record');
    } catch (error) {
      this.saveUnresolved(ip, error instanceof Error ? error.message : 'PTR lookup failed');
    }
  }

  private async forwardAddresses(domain: string, version: number): Promise<string[]> {
    try {
      return version === 6
        ? await this.withTimeout(this.resolver.resolve6(domain))
        : await this.withTimeout(this.resolver.resolve4(domain));
    } catch {
      return [];
    }
  }

  private saveUnresolved(ip: string, error: string): void {
    if (this.stopping) return;
    this.db.repos.vendor.saveIPDomainEnrichment({
      ip,
      status: 'unresolved',
      ttlHours: UNRESOLVED_TTL_HOURS,
      error,
    });
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error('DNS lookup timed out')), DNS_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
