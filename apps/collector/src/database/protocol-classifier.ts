import type {
  ApplicationProtocol,
  ProtocolConfidence,
  TransportProtocol,
} from '@neko-master/shared';

export interface ProtocolClassification {
  transport: TransportProtocol;
  applicationProtocol: ApplicationProtocol;
  confidence: ProtocolConfidence;
}

function normalizeTransport(value?: string): TransportProtocol {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'tcp' || normalized === 'udp') return normalized;
  return 'unknown';
}

export function classifyProtocol(
  network?: string,
  destinationPort?: string | number,
): ProtocolClassification {
  const transport = normalizeTransport(network);
  const port = Number.parseInt(String(destinationPort ?? ''), 10);

  if (port === 53 || port === 853) {
    return { transport, applicationProtocol: 'dns', confidence: 'inferred' };
  }
  if (transport === 'tcp' && (port === 80 || port === 8080)) {
    return { transport, applicationProtocol: 'http', confidence: 'inferred' };
  }
  if (transport === 'tcp' && (port === 443 || port === 8443)) {
    return { transport, applicationProtocol: 'tls', confidence: 'inferred' };
  }
  if (transport === 'udp' && (port === 443 || port === 8443)) {
    return { transport, applicationProtocol: 'quic', confidence: 'inferred' };
  }
  return { transport, applicationProtocol: 'other', confidence: 'unknown' };
}
