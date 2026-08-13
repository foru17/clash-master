import dns from 'node:dns/promises';
import type { VendorProbeResponse, VendorProbeResult, VendorProbeSuggestion } from '@neko-master/shared';
import type { StatsDatabase } from '../db/db.js';
import { getRegistrableDomain } from '../../database/registrable-domain.js';

type FetchLike = typeof fetch;

function firstText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function vcardValue(value: unknown, key: string): string | null {
  if (!Array.isArray(value) || value[0] !== 'vcard' || !Array.isArray(value[1])) return null;
  const row = value[1].find((entry) => Array.isArray(entry) && entry[0] === key);
  return Array.isArray(row) ? firstText(row[3]) || firstText(row[2]) : null;
}

function collectVcardValues(value: unknown, key: string, output: string[]): void {
  if (!Array.isArray(value)) return;
  const direct = vcardValue(value, key);
  if (direct) output.push(direct);
  for (const item of value) collectVcardValues(item, key, output);
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 200) || null;
}

function normalizeEvidence(value: string | null): string {
  return (value || '').toLowerCase();
}

export class VendorProbeService {
  constructor(
    private readonly db: StatsDatabase,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async probe(domains: string[]): Promise<VendorProbeResponse> {
    const unique = [...new Set(domains.map((domain) => getRegistrableDomain(domain)).filter(Boolean))].slice(0, 50);
    return { results: await Promise.all(unique.map((domain) => this.probeOne(domain))) };
  }

  private async probeOne(domain: string): Promise<VendorProbeResult> {
    const [dnsResult, httpResult, rdapResult] = await Promise.all([
      this.probeDns(domain),
      this.probeHttp(domain),
      this.probeRdap(domain),
    ]);
    const suggestions = this.suggest(domain, httpResult, rdapResult);
    return {
      domain,
      normalizedDomain: domain,
      dns: dnsResult,
      http: httpResult,
      rdap: rdapResult,
      suggestions,
    };
  }

  private async probeDns(domain: string): Promise<VendorProbeResult['dns']> {
    const addresses = new Set<string>();
    const cnames = new Set<string>();
    const errors: string[] = [];
    const lookups = await Promise.allSettled([
      dns.resolve4(domain),
      dns.resolve6(domain),
      dns.resolveCname(domain),
    ]);
    for (const [index, result] of lookups.entries()) {
      if (result.status === 'fulfilled') {
        for (const value of result.value) {
          if (index === 2) cnames.add(String(value));
          else addresses.add(String(value));
        }
      } else if (result.reason?.code !== 'ENODATA' && result.reason?.code !== 'ENOTFOUND') {
        errors.push(String(result.reason?.code || result.reason?.message || result.reason));
      }
    }
    return { addresses: [...addresses].slice(0, 12), cnames: [...cnames].slice(0, 12), error: errors[0] || null };
  }

  private async probeHttp(domain: string): Promise<VendorProbeResult['http']> {
    try {
      const response = await this.fetchImpl(`https://${domain}`, {
        redirect: 'follow',
        headers: { 'user-agent': 'Home-Network-Monitor/1.0 domain-probe' },
        signal: AbortSignal.timeout(8_000),
      });
      const html = (await response.text()).slice(0, 128_000);
      return {
        status: response.status,
        finalUrl: response.url || null,
        title: extractTitle(html),
        server: response.headers.get('server'),
        error: null,
      };
    } catch (error) {
      return { status: null, finalUrl: null, title: null, server: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async probeRdap(domain: string): Promise<VendorProbeResult['rdap']> {
    try {
      const response = await this.fetchImpl(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
        headers: { accept: 'application/rdap+json, application/json' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as Record<string, unknown>;
      const registrarValues: string[] = [];
      const organizationValues: string[] = [];
      const countryValues: string[] = [];
      collectVcardValues(body.registrars, 'fn', registrarValues);
      collectVcardValues(body.entities, 'fn', organizationValues);
      collectVcardValues(body.entities, 'org', organizationValues);
      collectVcardValues(body.entities, 'adr', countryValues);
      return {
        registrar: registrarValues[0] || null,
        organization: organizationValues.find((value) => value !== registrarValues[0]) || organizationValues[0] || null,
        country: countryValues[0] || null,
        error: null,
      };
    } catch (error) {
      return { registrar: null, organization: null, country: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private suggest(
    domain: string,
    http: VendorProbeResult['http'],
    rdap: VendorProbeResult['rdap'],
  ): VendorProbeSuggestion[] {
    const vendors = this.db.getVendors().filter((vendor) => vendor.enabled && vendor.slug !== 'unknown');
    const evidence = [domain, http.title, http.finalUrl, http.server, rdap.registrar, rdap.organization]
      .map(normalizeEvidence)
      .join(' ');
    const scored = vendors.map((vendor) => {
      const tokens = [vendor.slug, vendor.name, ...vendor.rules.filter((rule) => rule.source === 'manual').map((rule) => rule.pattern)]
        .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4));
      const matches = [...new Set(tokens.filter((token) => evidence.includes(token)))];
      if (!matches.length) return null;
      const strong = matches.some((token) => evidence.includes(token) && (domain.includes(token) || (http.title || '').toLowerCase().includes(token)));
      return {
        vendorId: vendor.id,
        vendorName: vendor.name,
        confidence: strong ? 'high' as const : 'medium' as const,
        reasons: matches.slice(0, 4).map((token) => `evidence:${token}`),
        score: (strong ? 10 : 3) + matches.length,
      };
    }).filter((value): value is VendorProbeSuggestion & { score: number } => !!value);
    return scored.sort((a, b) => b.score - a.score).slice(0, 3).map(({ score: _score, ...suggestion }) => suggestion);
  }
}
