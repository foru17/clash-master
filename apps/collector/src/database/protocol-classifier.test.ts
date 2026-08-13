import { describe, expect, it } from 'vitest';
import { classifyProtocol } from './protocol-classifier.js';

describe('classifyProtocol', () => {
  it('infers the application protocol without treating Clash inbound type as a protocol', () => {
    expect(classifyProtocol('tcp', 80)).toEqual({
      transport: 'tcp', applicationProtocol: 'http', confidence: 'inferred',
    });
    expect(classifyProtocol('tcp', '443')).toEqual({
      transport: 'tcp', applicationProtocol: 'tls', confidence: 'inferred',
    });
    expect(classifyProtocol('udp', 443)).toEqual({
      transport: 'udp', applicationProtocol: 'quic', confidence: 'inferred',
    });
    expect(classifyProtocol('udp', 53)).toEqual({
      transport: 'udp', applicationProtocol: 'dns', confidence: 'inferred',
    });
    expect(classifyProtocol('Redir', 443)).toEqual({
      transport: 'unknown', applicationProtocol: 'other', confidence: 'unknown',
    });
  });
});
