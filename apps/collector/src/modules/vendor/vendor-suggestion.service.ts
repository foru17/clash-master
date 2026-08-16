import type { StatsDatabase } from '../db/db.js';
import type { DomainEvidence } from './vendor-domain-evidence.service.js';

export interface ScoredVendorSuggestion {
  vendorId: number;
  vendorName: string;
  vendorSlug: string;
  confidence: 'high' | 'medium';
  score: number;
  reasons: string[];
}

const GENERIC_TOKENS = new Set([
  'http',
  'https',
  'www',
  'com',
  'org',
  'net',
  'cloud',
  'cdn',
  'inc',
  'ltd',
  'corp',
  'group',
  'company',
  'technologies',
  'technology',
  'services',
  'service',
  'network',
  'networks',
  'global',
  'china',
  'international',
]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !/^\d+$/.test(token) && !GENERIC_TOKENS.has(token));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function reasonFor(type: string, value: string): string {
  return `${type}:${value}`;
}

export class VendorSuggestionService {
  constructor(private readonly db: StatsDatabase) {}

  scoreDomainEvidence(domain: string, evidence: DomainEvidence): ScoredVendorSuggestion[] {
    const normalizedDomain = domain.trim().toLowerCase();
    const vendors = this.db.getVendors().filter((vendor) => vendor.enabled && vendor.slug !== 'unknown');
    const cnameTargets = unique([
      ...evidence.dns.cnameChain,
      ...evidence.dns.cnames,
    ]).filter(Boolean);
    const httpTitle = evidence.http.title || '';
    const httpFinalUrl = evidence.http.finalUrl || '';
    const httpServer = evidence.http.server || '';
    const rdapOrganization = evidence.rdap.organization || '';
    const rdapRegistrar = evidence.rdap.registrar || '';

    const domainTokens = tokenize(normalizedDomain);
    const titleTokens = tokenize(httpTitle);
    const finalUrlTokens = tokenize(httpFinalUrl);
    const evidenceText = [normalizedDomain, httpTitle, httpFinalUrl, httpServer, rdapOrganization, rdapRegistrar, ...cnameTargets].join(' ').toLowerCase();

    const cnameVendorHits = new Map<number, string[]>();
    for (const target of cnameTargets) {
      const classification = this.db.repos.vendor.classifyDomain(target);
      if (classification.unknown) continue;
      const current = cnameVendorHits.get(classification.vendorId) ?? [];
      if (current.length < 3) current.push(target);
      cnameVendorHits.set(classification.vendorId, current);
    }

    const scored: ScoredVendorSuggestion[] = [];
    for (const vendor of vendors) {
      const vendorTokens = unique([
        ...tokenize(vendor.slug),
        ...tokenize(vendor.name),
        ...vendor.rules
          .filter((rule) => rule.source === 'manual' || rule.source === 'builtin')
          .flatMap((rule) => tokenize(rule.pattern)),
      ]);
      if (vendorTokens.length === 0) continue;

      let score = 0;
      const reasons: string[] = [];
      const evidenceKinds = new Set<string>();

      const strongMatches = vendorTokens.filter((token) =>
        domainTokens.includes(token) || titleTokens.includes(token) || finalUrlTokens.includes(token),
      );
      if (strongMatches.length > 0) {
        score += 30 + Math.min(3, strongMatches.length);
        evidenceKinds.add('token');
        for (const token of strongMatches.slice(0, 3)) reasons.push(reasonFor('domain', token));
      } else {
        const weakMatches = vendorTokens.filter((token) => evidenceText.includes(token));
        if (weakMatches.length > 0) {
          score += 12;
          evidenceKinds.add('token');
          reasons.push(reasonFor('evidence', weakMatches[0]));
        }
      }

      const cnameHits = cnameVendorHits.get(vendor.id);
      if (cnameHits?.length) {
        // CDN/infrastructure vendors use a lower dictionary priority. A CNAME
        // to their edge is useful evidence, but it must not by itself turn an
        // unknown business domain into a high-confidence auto-apply.
        score += vendor.priority <= 20 ? 15 : 35;
        evidenceKinds.add('cname');
        reasons.push(reasonFor('cname', cnameHits[0]));
      }

      const rdapText = `${rdapOrganization} ${rdapRegistrar}`.toLowerCase();
      const rdapMatches = vendorTokens.filter((token) => rdapText.includes(token));
      if (rdapMatches.length > 0) {
        score += 25;
        evidenceKinds.add('rdap');
        reasons.push(reasonFor('rdap', rdapMatches[0]));
      }

      if (evidenceKinds.size >= 2) {
        score += 10;
        reasons.push(`multi-evidence:${[...evidenceKinds].join('+')}`);
      }

      if (score < 45) continue;
      score = Math.min(95, score);
      scored.push({
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorSlug: vendor.slug,
        confidence: score >= 70 ? 'high' : 'medium',
        score,
        reasons: reasons.slice(0, 8),
      });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  /**
   * AUTO_APPLY=1 only auto-applies an unambiguous high-confidence winner.
   * Medium-confidence suggestions always remain in the review queue.
   */
  shouldAutoApply(suggestions: ScoredVendorSuggestion[]): boolean {
    if (suggestions.length === 0) return false;
    const [first, second] = suggestions;
    return first.confidence === 'high'
      && first.score >= 75
      && (second === undefined || second.confidence !== 'high' || second.score <= first.score - 15);
  }
}
