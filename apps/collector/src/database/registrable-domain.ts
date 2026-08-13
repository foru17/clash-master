import { getDomain } from 'tldts';
import { normalizeDomain } from './vendor-classifier.js';

export function getRegistrableDomain(value: string): string {
  const domain = normalizeDomain(value);
  if (!domain) return '';
  return getDomain(domain, { allowPrivateDomains: true }) || domain;
}
