import { describe, expect, it } from 'vitest';
import { loadV2FlyCatalog } from './vendor-catalog.service.js';

describe('loadV2FlyCatalog', () => {
  it('expands includes, ignores unsupported rules and excludes cross-vendor conflicts', async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.includes('/contents/data')) {
        return Response.json([
          { name: 'apple', type: 'file' },
          { name: 'google', type: 'file' },
          { name: 'akamai', type: 'file' },
          { name: 'docker', type: 'file' },
          { name: 'readme.md', type: 'file' },
        ]);
      }
      const category = decodeURIComponent(url.split('/').pop() || '');
      const body = category === 'apple'
        ? 'domain:apple.example\nfull:api.apple.test\ninclude:shared\nregexp:^ignored'
        : category === 'google'
          ? 'google.example\nshared.example'
          : category === 'shared'
            ? 'shared.example\nincluded.example'
            : `${category}.example`;
      return new Response(body, { status: 200 });
    };

    const result = await loadV2FlyCatalog(
      'test-revision',
      fetchImpl as typeof fetch,
      [{ slug: 'custom-docker', name: 'Docker' }],
    );
    expect(result.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ vendorSlug: 'apple', pattern: 'apple.example', matchType: 'suffix' }),
      expect.objectContaining({ vendorSlug: 'apple', pattern: 'api.apple.test', matchType: 'exact' }),
      expect.objectContaining({ vendorSlug: 'apple', pattern: 'included.example' }),
      expect.objectContaining({ vendorSlug: 'google', pattern: 'google.example' }),
      expect.objectContaining({ vendorSlug: 'akamai', pattern: 'akamai.example' }),
      expect.objectContaining({ vendorSlug: 'fastly', pattern: 'fastly.example' }),
      expect.objectContaining({ vendorSlug: 'kingsoft', pattern: 'kingsoft.example' }),
      expect.objectContaining({ vendorSlug: 'baishancloud', pattern: 'baishancloud.example' }),
      expect.objectContaining({ vendorSlug: 'baidu', pattern: 'baidu.example' }),
      expect.objectContaining({ vendorSlug: 'custom-docker', pattern: 'docker.example' }),
    ]));
    expect(result.rules.some((rule) => rule.pattern === 'shared.example')).toBe(false);
    expect(result.conflictCount).toBeGreaterThanOrEqual(1);
    expect(result.excludedCount).toBeGreaterThanOrEqual(1);
  });
});
