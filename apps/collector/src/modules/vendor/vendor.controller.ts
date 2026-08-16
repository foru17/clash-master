import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { VendorInput } from '../../database/repositories/vendor.repository.js';
import { getRegistrableDomain } from '../../database/registrable-domain.js';

function parseId(value: unknown): number | null {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export const vendorController: FastifyPluginAsync = async (
  fastify: FastifyInstance,
): Promise<void> => {
  fastify.get('/', async () => fastify.db.getVendors());

  fastify.get('/stats', async (request, reply) => {
    const query = request.query as {
      backendId?: string;
      start?: string;
      end?: string;
      sourceIP?: string;
    };
    const backendId = parseId(query.backendId);
    if (!backendId || !fastify.db.getBackend(backendId)) {
      return reply.status(400).send({ error: 'A valid backendId is required' });
    }
    const end = query.end || new Date().toISOString();
    const start = query.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      return fastify.db.getVendorStats(backendId, start, end, query.sourceIP?.trim() || undefined);
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Invalid vendor stats query',
      });
    }
  });

  fastify.get('/automation', async (request, reply) => {
    const backendId = parseId((request.query as { backendId?: string }).backendId);
    if (!backendId || !fastify.db.getBackend(backendId)) {
      return reply.status(400).send({ error: 'A valid backendId is required' });
    }
    try {
      const catalog = await fastify.vendorCatalogService.getAutomation(backendId);
      const snifferImpact = fastify.db.repos.vendor.getSnifferImpact(backendId, 7);
      const suggestions = fastify.vendorAutomationService.getSuggestions(backendId, 'pending', 50);
      return {
        ...catalog,
        suggestions,
        evidenceStats: fastify.vendorAutomationService.getEvidenceStats(backendId),
        snifferImpact: {
          ...snifferImpact,
          potentialRate: snifferImpact.totalTraffic > 0
            ? snifferImpact.potentiallyRecoverableTraffic / snifferImpact.totalTraffic
            : 0,
        },
      };
    } catch (error) {
      return reply.status(502).send({
        error: error instanceof Error ? error.message : 'Unable to load vendor automation status',
      });
    }
  });

  fastify.post('/automation/run', async (_request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    try {
      return await fastify.vendorAutomationService.runNow();
    } catch (error) {
      return reply.status(502).send({
        error: error instanceof Error ? error.message : 'Unable to run vendor automation',
      });
    }
  });

  fastify.get('/suggestions', async (request, reply) => {
    const query = request.query as { backendId?: string; status?: string; limit?: string };
    const backendId = parseId(query.backendId);
    if (backendId && !fastify.db.getBackend(backendId)) {
      return reply.status(400).send({ error: 'A valid backendId is required' });
    }
    const status = query.status === 'applied' || query.status === 'dismissed' || query.status === 'stale'
      ? query.status
      : 'pending';
    const limit = Number.parseInt(query.limit || '100', 10);
    return fastify.vendorAutomationService.getSuggestions(
      backendId ?? undefined,
      status,
      Number.isFinite(limit) ? limit : 100,
    );
  });

  fastify.post('/suggestions/:id/apply', async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const id = parseId((request.params as { id?: string }).id);
    if (!id) return reply.status(400).send({ error: 'Invalid suggestion id' });
    try {
      return fastify.vendorAutomationService.applySuggestion(id);
    } catch (error) {
      return reply.status(409).send({
        error: error instanceof Error ? error.message : 'Unable to apply vendor suggestion',
      });
    }
  });

  fastify.post('/suggestions/:id/dismiss', async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const id = parseId((request.params as { id?: string }).id);
    if (!id) return reply.status(400).send({ error: 'Invalid suggestion id' });
    const dismissed = fastify.vendorAutomationService.dismissSuggestion(id);
    if (!dismissed) return reply.status(404).send({ error: 'Pending suggestion not found' });
    return { success: true, id };
  });

  fastify.post('/probe', async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const body = (request.body || {}) as { backendId?: unknown; domains?: unknown };
    const backendId = parseId(body.backendId);
    if (!backendId || !fastify.db.getBackend(backendId)) {
      return reply.status(400).send({ error: 'A valid backendId is required' });
    }
    if (!Array.isArray(body.domains) || body.domains.length === 0 || body.domains.length > 50) {
      return reply.status(400).send({ error: 'domains must contain between 1 and 50 candidates' });
    }
    const candidateDomains = new Set(
      fastify.db.repos.vendor.getUnknownCandidates(backendId, 30, 200)
        .map((candidate) => candidate.registrableDomain),
    );
    const domains = body.domains
      .map((domain) => getRegistrableDomain(String(domain)))
      .filter((domain, index, all) => Boolean(domain) && all.indexOf(domain) === index)
      .filter((domain) => candidateDomains.has(domain));
    if (domains.length === 0) {
      return reply.status(400).send({ error: 'Only current unknown candidates can be probed' });
    }
    try {
      return await fastify.vendorProbeService.probe(domains);
    } catch (error) {
      return reply.status(502).send({
        error: error instanceof Error ? error.message : 'Unable to probe vendor domain',
      });
    }
  });

  fastify.get('/:id/endpoints', async (request, reply) => {
    const query = request.query as {
      backendId?: string; start?: string; end?: string; sourceIP?: string; limit?: string;
    };
    const vendorId = parseId((request.params as { id?: string }).id);
    const backendId = parseId(query.backendId);
    if (!vendorId || !fastify.db.getVendors().some((vendor) => vendor.id === vendorId)) {
      return reply.status(404).send({ error: 'Vendor not found' });
    }
    if (!backendId || !fastify.db.getBackend(backendId)) {
      return reply.status(400).send({ error: 'A valid backendId is required' });
    }
    const end = query.end || new Date().toISOString();
    const start = query.start || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    try {
      const load = () => fastify.db.repos.vendor.getEndpointStats(
        backendId, vendorId, start, end, query.sourceIP?.trim() || undefined,
        Number.parseInt(query.limit || '10', 10),
      );
      const result = load();
      const changed = fastify.vendorIPEnrichmentService.prepare(
        result.endpoints
          .filter((endpoint) => endpoint.endpointType === 'ip')
          .map((endpoint) => endpoint.endpoint),
      );
      return changed ? load() : result;
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Invalid endpoint stats query',
      });
    }
  });

  fastify.post('/catalog/sync', async (_request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    try {
      return await fastify.vendorCatalogService.syncNow(true);
    } catch (error) {
      return reply.status(502).send({
        error: error instanceof Error ? error.message : 'Unable to sync vendor catalog',
      });
    }
  });

  fastify.post('/reclassify', async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const rawDays = Number.parseInt(String((request.body as { days?: number } | undefined)?.days ?? 30), 10);
    const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(365, rawDays)) : 30;
    return fastify.db.repos.vendor.reclassifyRecentHistory(days);
  });

  fastify.post('/', async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const body = request.body as VendorInput;
    try {
      const vendor = fastify.db.createVendor(body);
      return reply.status(201).send(vendor);
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Unable to create vendor',
      });
    }
  });

  fastify.put('/:id', async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const id = parseId((request.params as { id?: string }).id);
    if (!id) return reply.status(400).send({ error: 'Invalid vendor id' });
    try {
      const vendor = fastify.db.updateVendor(id, request.body as Partial<VendorInput>);
      if (!vendor) return reply.status(404).send({ error: 'Vendor not found' });
      return vendor;
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Unable to update vendor',
      });
    }
  });
};
