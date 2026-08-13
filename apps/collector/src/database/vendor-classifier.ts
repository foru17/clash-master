import type Database from 'better-sqlite3';

export interface CompiledVendorRule {
  vendorId: number;
  pattern: string;
  matchType: 'exact' | 'suffix';
  priority: number;
}

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

export class VendorClassifier {
  private readonly exactRules = new Map<string, CompiledVendorRule>();
  private readonly suffixRules = new Map<string, CompiledVendorRule>();
  private readonly unknownVendorId: number;

  constructor(db: Database.Database) {
    const unknown = db.prepare(
      `SELECT id FROM vendors WHERE slug = 'unknown' LIMIT 1`,
    ).get() as { id: number } | undefined;
    if (!unknown) {
      throw new Error('Unknown vendor seed is missing');
    }
    this.unknownVendorId = unknown.id;
    const rules = db.prepare(`
      SELECT r.vendor_id AS vendorId,
             LOWER(TRIM(r.pattern, '.')) AS pattern,
             r.match_type AS matchType,
             r.priority + v.priority + CASE r.source
               WHEN 'manual' THEN 1000000
               WHEN 'builtin' THEN 100000
               ELSE 0
             END AS priority
      FROM vendor_domain_rules r
      JOIN vendors v ON v.id = r.vendor_id
      WHERE v.enabled = 1
      ORDER BY priority DESC, LENGTH(r.pattern) DESC,
               CASE r.match_type WHEN 'exact' THEN 0 ELSE 1 END
    `).all() as CompiledVendorRule[];
    for (const rule of rules) {
      const target = rule.matchType === 'exact' ? this.exactRules : this.suffixRules;
      if (!target.has(rule.pattern)) target.set(rule.pattern, rule);
    }
  }

  classify(domainValue: string): number {
    const domain = normalizeDomain(domainValue);
    if (!domain) return this.unknownVendorId;

    let best = this.exactRules.get(domain);
    const labels = domain.split('.');
    for (let index = 0; index < labels.length; index += 1) {
      const rule = this.suffixRules.get(labels.slice(index).join('.'));
      if (!rule) continue;
      if (
        !best ||
        rule.priority > best.priority ||
        (rule.priority === best.priority && rule.pattern.length > best.pattern.length)
      ) {
        best = rule;
      }
    }
    return best?.vendorId ?? this.unknownVendorId;
  }

  isUnknown(vendorId: number): boolean {
    return vendorId === this.unknownVendorId;
  }
}
