import * as dns from 'node:dns/promises';

export interface DomainDNSEvidence {
  addresses: string[];
  cnames: string[];
  cnameChain: string[];
  error: string | null;
}

export interface DomainHTTPEvidence {
  status: number | null;
  finalUrl: string | null;
  title: string | null;
  server: string | null;
  error: string | null;
}

export interface DomainRDAPEvidence {
  registrar: string | null;
  organization: string | null;
  country: string | null;
  error: string | null;
}

export interface DomainEvidence {
  domain: string;
  dns: DomainDNSEvidence;
  http: DomainHTTPEvidence;
  rdap: DomainRDAPEvidence;
  collectedAt: string;
}

type FetchLike = typeof fetch;

interface DNSResolver {
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
  resolveCname(domain: string): Promise<string[]>;
}

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

export class VendorDomainEvidenceService {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly resolver: DNSResolver = dns,
  ) {}

  async collect(
    domain: string,
    options: { http?: boolean; rdap?: boolean } = {},
  ): Promise<DomainEvidence> {
    const [dnsResult, httpResult, rdapResult] = await Promise.all([
      this.collectDns(domain),
      options.http === false ? Promise.resolve(emptyHTTPEvidence()) : this.collectHttp(domain),
      options.rdap === false ? Promise.resolve(emptyRDAPEvidence()) : this.collectRdap(domain),
    ]);
    return {
      domain,
      dns: dnsResult.dns,
      http: httpResult,
      rdap: rdapResult,
      collectedAt: new Date().toISOString(),
    };
  }

  private async collectDns(domain: string): Promise<{
    dns: DomainDNSEvidence;
  }> {
    const addresses = new Set<string>();
    const cnames = new Set<string>();
    const errors: string[] = [];
    const lookups = await Promise.allSettled([
      this.resolver.resolve4(domain),
      this.resolver.resolve6(domain),
      this.resolver.resolveCname(domain),
    ]);
    for (const [index, result] of lookups.entries()) {
      if (result.status === 'fulfilled') {
        for (const value of result.value) {
          if (index === 2) cnames.add(String(value).replace(/\.$/, '').toLowerCase());
          else addresses.add(String(value));
        }
      } else if (result.reason?.code !== 'ENODATA' && result.reason?.code !== 'ENOTFOUND') {
        errors.push(String(result.reason?.code || result.reason?.message || result.reason));
      }
    }
    const chain = await this.resolveCnameChain([...cnames]);
    return {
      dns: {
        addresses: [...addresses].slice(0, 12),
        cnames: [...cnames].slice(0, 12),
        cnameChain: chain.slice(0, 8),
        error: errors[0] || null,
      },
    };
  }

  private async resolveCnameChain(initial: string[]): Promise<string[]> {
    const seen = new Set(initial);
    const chain = [...initial];
    if (initial.length === 0) return chain;
    let current = initial[initial.length - 1];
    for (let depth = 0; depth < 5; depth += 1) {
      try {
        const names = await this.withTimeout(this.resolver.resolveCname(current), 3000);
        const normalized = names
          .map((name) => String(name).replace(/\.$/, '').toLowerCase())
          .filter((name) => name && !seen.has(name));
        if (normalized.length === 0) break;
        seen.add(normalized[0]);
        chain.push(normalized[0]);
        current = normalized[0];
      } catch {
        break;
      }
    }
    return chain;
  }

  private async collectHttp(domain: string): Promise<DomainHTTPEvidence> {
    try {
      const response = await this.fetchImpl(`https://${domain}`, {
        redirect: 'follow',
        headers: { 'user-agent': 'Home-Network-Monitor/1.1 domain-evidence' },
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
      return {
        status: null,
        finalUrl: null,
        title: null,
        server: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async collectRdap(domain: string): Promise<DomainRDAPEvidence> {
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
      return {
        registrar: null,
        organization: null,
        country: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error('DNS lookup timed out')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function emptyHTTPEvidence(): DomainHTTPEvidence {
  return {
    status: null,
    finalUrl: null,
    title: null,
    server: null,
    error: 'disabled by VENDOR_AUTOMATION_HTTP_PROBE=0',
  };
}

function emptyRDAPEvidence(): DomainRDAPEvidence {
  return {
    registrar: null,
    organization: null,
    country: null,
    error: 'disabled by VENDOR_AUTOMATION_RDAP_PROBE=0',
  };
}
