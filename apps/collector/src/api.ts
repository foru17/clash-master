import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { StatsDatabase } from './db.js';

export class APIServer {
  private app: ReturnType<typeof Fastify> | null = null;
  private db: StatsDatabase;
  private port: number;

  constructor(port: number, db: StatsDatabase) {
    this.port = port;
    this.db = db;
  }

  async start() {
    const app = Fastify({ logger: false });
    this.app = app;

    await app.register(cors, {
      origin: true,
      credentials: true
    });

    const parseOptionalPositiveInt = (value: unknown): number | null => {
      if (value === undefined || value === null || value === '') {
        return null;
      }
      const parsed = Number.parseInt(String(value), 10);
      if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
        return null;
      }
      return parsed;
    };

    const parseBoundedInt = (value: unknown, fallback: number, min: number, max: number): number => {
      const parsed = Number.parseInt(String(value), 10);
      if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
        return fallback;
      }
      return Math.min(max, Math.max(min, parsed));
    };

    // Helper to get backend ID from query or use active backend
    const getBackendId = (request: any): number | null => {
      const { backendId } = request.query as { backendId?: string };
      if (backendId !== undefined) {
        return parseOptionalPositiveInt(backendId);
      }
      // If no backendId specified, use the active backend
      const activeBackend = this.db.getActiveBackend();
      return activeBackend?.id ?? null;
    };

    // Health check
    app.get('/health', async () => ({ status: 'ok' }));

    // Get summary statistics for a specific backend
    app.get('/api/stats/summary', async (request, reply) => {
      const backendId = getBackendId(request);
      
      if (backendId === null) {
        return reply.status(404).send({ error: 'No backend specified or active' });
      }

      const backend = this.db.getBackend(backendId);
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      const { topLimit = '1000' } = request.query as { topLimit?: string };
      const safeTopLimit = parseBoundedInt(topLimit, 1000, 10, 5000);

      const summary = this.db.getSummary(backendId);
      const topDomains = this.db.getTopDomains(backendId, safeTopLimit);
      const topIPs = this.db.getTopIPs(backendId, safeTopLimit);
      const proxyStats = this.db.getProxyStats(backendId);
      const ruleStats = this.db.getRuleStats(backendId);
      const hourlyStats = this.db.getHourlyStats(backendId, 24);
      const todayTraffic = this.db.getTodayTraffic(backendId);

      return {
        backend: {
          id: backend.id,
          name: backend.name,
          isActive: backend.is_active,
          listening: backend.listening,
        },
        totalConnections: summary.totalConnections,
        totalUpload: summary.totalUpload,
        totalDownload: summary.totalDownload,
        totalDomains: summary.uniqueDomains,
        totalIPs: summary.uniqueIPs,
        totalRules: ruleStats.length,
        totalProxies: proxyStats.length,
        todayUpload: todayTraffic.upload,
        todayDownload: todayTraffic.download,
        topDomains,
        topIPs,
        proxyStats,
        ruleStats,
        hourlyStats
      };
    });

    // Get global summary across all backends
    app.get('/api/stats/global', async () => {
      return this.db.getGlobalSummary();
    });

    // Get domain statistics for a specific backend
    app.get('/api/stats/domains', async (request, reply) => {
      const backendId = getBackendId(request);
      
      if (backendId === null) {
        return reply.status(404).send({ error: 'No backend specified or active' });
      }

      const { limit = 50 } = request.query as { limit?: string };
      return this.db.getDomainStats(backendId, parseBoundedInt(limit, 50, 1, 5000));
    });

    // Get IP statistics for a specific backend
    app.get('/api/stats/ips', async (request, reply) => {
      const backendId = getBackendId(request);
      
      if (backendId === null) {
        return reply.status(404).send({ error: 'No backend specified or active' });
      }

      const { limit = 50 } = request.query as { limit?: string };
      return this.db.getIPStats(backendId, parseBoundedInt(limit, 50, 1, 5000));
    });

    // Get proxy/chain statistics for a specific backend
    app.get('/api/stats/proxies', async (request, reply) => {
      const backendId = getBackendId(request);
      
      if (backendId === null) {
        return reply.status(404).send({ error: 'No backend specified or active' });
      }

      return this.db.getProxyStats(backendId);
    });

    // Get rule statistics for a specific backend
    app.get('/api/stats/rules', async (request, reply) => {
      const backendId = getBackendId(request);
      
      if (backendId === null) {
        return reply.status(404).send({ error: 'No backend specified or active' });
      }

      return this.db.getRuleStats(backendId);
    });

    // Get rule to proxy mapping for a specific backend
    app.get('/api/stats/rule-proxy-map', async (request, reply) => {
      const backendId = getBackendId(request);
      
      if (backendId === null) {
        return reply.status(404).send({ error: 'No backend specified or active' });
      }

      return this.db.getRuleProxyMap(backendId);
    });

    // Get country traffic statistics for a specific backend
    app.get('/api/stats/countries', async (request, reply) => {
      const backendId = getBackendId(request);
      
      if (backendId === null) {
        return reply.status(404).send({ error: 'No backend specified or active' });
      }

      return this.db.getCountryStats(backendId);
    });

    // Get hourly statistics for a specific backend
    app.get('/api/stats/hourly', async (request, reply) => {
      const backendId = getBackendId(request);
      
      if (backendId === null) {
        return reply.status(404).send({ error: 'No backend specified or active' });
      }

      const { hours = 24 } = request.query as { hours?: string };
      return this.db.getHourlyStats(backendId, parseBoundedInt(hours, 24, 1, 24 * 14));
    });

    // Get traffic trend for a specific backend (for time range selection)
    app.get('/api/stats/trend', async (request, reply) => {
      const backendId = getBackendId(request);
      
      if (backendId === null) {
        return reply.status(404).send({ error: 'No backend specified or active' });
      }

      const { minutes = 30 } = request.query as { minutes?: string };
      return this.db.getTrafficTrend(backendId, parseBoundedInt(minutes, 30, 1, 24 * 60));
    });

    // Get traffic trend aggregated by time buckets for chart display
    app.get('/api/stats/trend/aggregated', async (request, reply) => {
      const backendId = getBackendId(request);
      
      if (backendId === null) {
        return reply.status(404).send({ error: 'No backend specified or active' });
      }

      const { minutes = 30, bucketMinutes = 1 } = request.query as { minutes?: string; bucketMinutes?: string };
      return this.db.getTrafficTrendAggregated(
        backendId,
        parseBoundedInt(minutes, 30, 1, 24 * 60),
        parseBoundedInt(bucketMinutes, 1, 1, 60)
      );
    });

    // Get recent connections for a specific backend
    app.get('/api/stats/connections', async (request, reply) => {
      const backendId = getBackendId(request);
      
      if (backendId === null) {
        return reply.status(404).send({ error: 'No backend specified or active' });
      }

      const { limit = 100 } = request.query as { limit?: string };
      return this.db.getRecentConnections(backendId, parseBoundedInt(limit, 100, 1, 5000));
    });

    // Backend management APIs
    // Get all backends
    app.get('/api/backends', async () => {
      const backends = this.db.getAllBackends();
      // Don't return tokens for security
      return backends.map(({ token, ...rest }) => ({ ...rest, hasToken: !!token }));
    });

    // Get active backend
    app.get('/api/backends/active', async () => {
      const backend = this.db.getActiveBackend();
      if (!backend) {
        return { error: 'No active backend configured' };
      }
      // Don't return token for security
      const { token, ...rest } = backend;
      return { ...rest, hasToken: !!token };
    });

    // Get listening backends (all backends currently collecting data)
    app.get('/api/backends/listening', async () => {
      const backends = this.db.getListeningBackends();
      return backends.map(({ token, ...rest }) => ({ ...rest, hasToken: !!token }));
    });

    // Create new backend
    app.post('/api/backends', async (request, reply) => {
      const { name, url, token } = request.body as { name: string; url: string; token?: string };
      
      if (!name || !url) {
        return reply.status(400).send({ error: 'Name and URL are required' });
      }
      
      try {
        // Check if this is the first backend
        const existingBackends = this.db.getAllBackends();
        const isFirstBackend = existingBackends.length === 0;
        
        const id = this.db.createBackend({ name, url, token });
        
        // If this is the first backend, automatically set it as active
        if (isFirstBackend) {
          this.db.setActiveBackend(id);
          console.log(`[API] First backend created, automatically set as active: ${name} (ID: ${id})`);
        }
        
        return { id, isActive: isFirstBackend, message: 'Backend created successfully' };
      } catch (error: any) {
        if (error.message?.includes('UNIQUE constraint failed')) {
          return reply.status(409).send({ error: 'Backend name already exists' });
        }
        throw error;
      }
    });

    // Update backend
    app.put('/api/backends/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const { name, url, token, enabled, listening } = request.body as { 
        name?: string; 
        url?: string; 
        token?: string;
        enabled?: boolean;
        listening?: boolean;
      };
      
      const backendId = parseInt(id);
      const backend = this.db.getBackend(backendId);
      
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }
      
      this.db.updateBackend(backendId, { name, url, token, enabled, listening });
      return { message: 'Backend updated successfully' };
    });

    // Delete backend
    app.delete('/api/backends/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const backendId = parseInt(id);
      
      const backend = this.db.getBackend(backendId);
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }
      
      this.db.deleteBackend(backendId);
      return { message: 'Backend deleted successfully' };
    });

    // Set active backend (for display in UI)
    app.post('/api/backends/:id/activate', async (request, reply) => {
      const { id } = request.params as { id: string };
      const backendId = parseInt(id);
      
      const backend = this.db.getBackend(backendId);
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }
      
      this.db.setActiveBackend(backendId);
      return { message: 'Backend activated successfully' };
    });

    // Set listening state for a backend (controls data collection)
    app.post('/api/backends/:id/listening', async (request, reply) => {
      const { id } = request.params as { id: string };
      const { listening } = request.body as { listening: boolean };
      
      const backendId = parseInt(id);
      const backend = this.db.getBackend(backendId);
      
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }
      
      this.db.setBackendListening(backendId, listening);
      return { message: `Backend ${listening ? 'started' : 'stopped'} listening` };
    });

    // Test backend connection
    app.post('/api/backends/test', async (request) => {
      const { url, token } = request.body as { url: string; token?: string };
      
      try {
        const wsUrl = url.replace('http://', 'ws://').replace('https://', 'wss://');
        const fullUrl = wsUrl.includes('/connections') ? wsUrl : `${wsUrl}/connections`;
        
        const headers: Record<string, string> = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        
        // Try to establish WebSocket connection
        const WebSocket = (await import('ws')).default;
        
        return new Promise((resolve) => {
          const ws = new WebSocket(fullUrl, { headers, timeout: 5000 });
          
          ws.on('open', () => {
            ws.close();
            resolve({ success: true, message: 'Connection successful' });
          });
          
          ws.on('error', (error: any) => {
            resolve({ success: false, message: error.message || 'Connection failed' });
          });
          
          ws.on('close', (code: number) => {
            if (code !== 1000 && code !== 1005) {
              resolve({ success: false, message: `Connection closed with code ${code}` });
            }
          });
          
          // Timeout after 5 seconds
          setTimeout(() => {
            ws.terminate();
            resolve({ success: false, message: 'Connection timeout' });
          }, 5000);
        });
      } catch (error: any) {
        return { success: false, message: error.message || 'Connection failed' };
      }
    });

    // Clear all data for a specific backend
    app.post('/api/backends/:id/clear-data', async (request, reply) => {
      const { id } = request.params as { id: string };
      const backendId = parseInt(id);
      
      const backend = this.db.getBackend(backendId);
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }
      
      this.db.deleteBackendData(backendId);
      return { message: 'Backend data cleared successfully' };
    });

    // Database management APIs
    // Get database stats
    app.get('/api/db/stats', async () => {
      return {
        size: this.db.getDatabaseSize(),
        totalConnectionsCount: this.db.getTotalConnectionLogsCount(),
      };
    });

    // Clear old logs (for all backends or specific backend)
    // days=0 means clear all logs
    app.post('/api/db/cleanup', async (request) => {
      const { days, backendId } = request.body as { days: number; backendId?: number };
      
      if (typeof days !== 'number' || days < 0) {
        return { error: 'Valid days parameter required' };
      }

      const result = this.db.cleanupOldData(backendId || null, days);
      
      if (days === 0) {
        return { 
          message: `Cleaned all data: ${result.deletedConnections} connections, ${result.deletedDomains} domains, ${result.deletedProxies} proxies`,
          deleted: result.deletedConnections,
          domains: result.deletedDomains,
          ips: result.deletedIPs,
          proxies: result.deletedProxies,
          rules: result.deletedRules
        };
      }
      
      return { 
        message: `Cleaned ${result.deletedConnections} old connection logs`,
        deleted: result.deletedConnections
      };
    });

    // Vacuum database
    app.post('/api/db/vacuum', async () => {
      this.db.vacuum();
      return { message: 'Database vacuumed successfully' };
    });

    await app.listen({ port: this.port, host: '0.0.0.0' });
    console.log(`[API] Server running at http://localhost:${this.port}`);

    return app;
  }

  stop() {
    if (this.app) {
      this.app.close();
      console.log('[API] Server stopped');
    }
  }
}
