import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { MonitorInput } from '../../database/repositories/monitor.repository.js';

function parseId(value: unknown): number | null {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export const monitorController: FastifyPluginAsync = async (
  fastify: FastifyInstance,
): Promise<void> => {
  fastify.get('/', async () => fastify.db.repos.monitor.getMonitors());

  fastify.get('/incidents', async (request) => {
    const query = request.query as { limit?: string };
    return fastify.db.repos.monitor.getIncidents(Math.min(500, parseId(query.limit) ?? 100));
  });

  fastify.get('/webhook', async () => fastify.db.repos.monitor.getWebhookConfig());

  fastify.get('/overview', async (request, reply) => {
    const query = request.query as { start?: string; end?: string; points?: string };
    const end = query.end || new Date().toISOString();
    const start = query.start || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(start) > Date.parse(end)) {
      return reply.status(400).send({ error: 'Invalid time range' });
    }
    return fastify.db.repos.monitor.getOverview(start, end, Number.parseInt(query.points || '96', 10));
  });

  fastify.put('/webhook', async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) return reply.status(403).send({ error: 'Forbidden' });
    const body = request.body as { enabled?: boolean; url?: string };
    const url = body.url?.trim() || '';
    if (url) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
      } catch {
        return reply.status(400).send({ error: 'Webhook URL must be http/https' });
      }
    }
    return fastify.db.repos.monitor.updateWebhookConfig({ enabled: body.enabled === true, url });
  });

  fastify.post('/', async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) return reply.status(403).send({ error: 'Forbidden' });
    try {
      return reply.status(201).send(
        fastify.db.repos.monitor.createMonitor(request.body as MonitorInput),
      );
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Unable to create monitor' });
    }
  });

  fastify.put('/:id', async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) return reply.status(403).send({ error: 'Forbidden' });
    const id = parseId((request.params as { id?: string }).id);
    if (!id) return reply.status(400).send({ error: 'Invalid monitor id' });
    try {
      const monitor = fastify.db.repos.monitor.updateMonitor(id, request.body as Partial<MonitorInput>);
      if (!monitor) return reply.status(404).send({ error: 'Monitor not found' });
      return monitor;
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Unable to update monitor' });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) return reply.status(403).send({ error: 'Forbidden' });
    const id = parseId((request.params as { id?: string }).id);
    if (!id) return reply.status(400).send({ error: 'Invalid monitor id' });
    if (!fastify.db.repos.monitor.deleteMonitor(id)) {
      return reply.status(404).send({ error: 'Monitor not found' });
    }
    return { ok: true };
  });

  fastify.post('/:id/test', async (request, reply) => {
    const id = parseId((request.params as { id?: string }).id);
    if (!id) return reply.status(400).send({ error: 'Invalid monitor id' });
    const monitor = fastify.db.repos.monitor.getMonitor(id);
    if (!monitor) return reply.status(404).send({ error: 'Monitor not found' });
    return fastify.monitorService.testMonitor(monitor);
  });

  fastify.get('/:id/history', async (request, reply) => {
    const id = parseId((request.params as { id?: string }).id);
    if (!id || !fastify.db.repos.monitor.getMonitor(id)) {
      return reply.status(404).send({ error: 'Monitor not found' });
    }
    const query = request.query as { start?: string; end?: string };
    const end = query.end || new Date().toISOString();
    const start = query.start || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    try {
      return fastify.db.repos.monitor.getHistory(id, start, end);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid range' });
    }
  });
};
