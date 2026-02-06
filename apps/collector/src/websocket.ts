import { WebSocketServer as WSServer, WebSocket } from 'ws';
import type { StatsSummary } from '@clashmaster/shared';
import type { StatsDatabase } from './db.js';

export interface WebSocketMessage {
  type: 'stats' | 'ping' | 'pong' | 'subscribe';
  backendId?: number;
  data?: StatsSummary;
  timestamp: string;
}

interface ClientInfo {
  ws: WebSocket;
  backendId: number | null; // null means use active backend
}

export class StatsWebSocketServer {
  private wss: WSServer | null = null;
  private db: StatsDatabase;
  private clients: Map<WebSocket, ClientInfo> = new Map();
  private port: number;
  private lastBroadcastTime: number = 0;
  private broadcastThrottleMs: number = 1000; // Minimum time between broadcasts

  constructor(port: number, db: StatsDatabase) {
    this.port = port;
    this.db = db;
  }

  start() {
    this.wss = new WSServer({ 
      port: this.port, 
      host: '0.0.0.0',
      perMessageDeflate: false,
    });

    this.wss.on('connection', (ws: WebSocket, req) => {
      console.log(`[WebSocket] Connection from ${req.socket.remoteAddress}`);
      console.log(`[WebSocket] Client connected, total: ${this.clients.size + 1}`);
      
      // Store client with default to active backend
      const clientInfo: ClientInfo = { ws, backendId: null };
      this.clients.set(ws, clientInfo);

      // Send initial stats
      this.sendStatsToClient(ws);

      // Handle messages
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as WebSocketMessage;
          
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          } else if (msg.type === 'subscribe' && msg.backendId !== undefined) {
            // Client wants to subscribe to a specific backend
            const backend = this.db.getBackend(msg.backendId);
            if (backend) {
              clientInfo.backendId = msg.backendId;
              console.log(`[WebSocket] Client subscribed to backend: ${backend.name} (ID: ${msg.backendId})`);
              // Send immediate update
              this.sendStatsToClient(ws);
            } else {
              console.warn(`[WebSocket] Client tried to subscribe to non-existent backend: ${msg.backendId}`);
            }
          }
        } catch (err) {
          // Ignore invalid messages
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[WebSocket] Client disconnected, remaining: ${this.clients.size}`);
      });

      ws.on('error', (err) => {
        console.error('[WebSocket] Client error:', err.message);
        this.clients.delete(ws);
      });
    });

    console.log(`[WebSocket] Server running at ws://0.0.0.0:${this.port}`);
  }

  private getStatsForBackend(backendId: number | null): StatsSummary | null {
    // If no backendId specified, use the active backend
    if (backendId === null) {
      const activeBackend = this.db.getActiveBackend();
      if (!activeBackend) {
        return null;
      }
      backendId = activeBackend.id;
    }

    const backend = this.db.getBackend(backendId);
    if (!backend) {
      return null;
    }

    const summary = this.db.getSummary(backendId);
    const topDomains = this.db.getTopDomains(backendId, 100);
    const topIPs = this.db.getTopIPs(backendId, 100);
    const proxyStats = this.db.getProxyStats(backendId);
    const ruleStats = this.db.getRuleStats(backendId);
    const hourly = this.db.getHourlyStats(backendId, 24);

    return {
      totalUpload: summary.totalUpload,
      totalDownload: summary.totalDownload,
      totalConnections: summary.totalConnections,
      totalDomains: summary.uniqueDomains,
      totalIPs: summary.uniqueIPs,
      totalProxies: proxyStats.length,
      topDomains,
      topIPs,
      proxyStats,
      ruleStats,
      hourlyStats: hourly
    };
  }

  private buildStatsMessage(stats: StatsSummary, timestamp = new Date().toISOString()): string {
    const message: WebSocketMessage = {
      type: 'stats',
      data: stats,
      timestamp
    };
    return JSON.stringify(message);
  }

  private getBackendCacheKey(backendId: number | null): string {
    return backendId === null ? 'active' : `backend:${backendId}`;
  }

  private async sendStatsToClient(ws: WebSocket) {
    if (ws.readyState !== WebSocket.OPEN) return;
    
    const clientInfo = this.clients.get(ws);
    if (!clientInfo) return;

    try {
      const stats = this.getStatsForBackend(clientInfo.backendId);
      if (!stats) {
        ws.send(JSON.stringify({ 
          type: 'stats', 
          error: 'No backend available',
          timestamp: new Date().toISOString() 
        }));
        return;
      }
      
      ws.send(this.buildStatsMessage(stats));
    } catch (err) {
      console.error('[WebSocket] Error sending stats:', err);
    }
  }

  // Broadcast stats to all connected clients
  async broadcastStats(force = false) {
    const now = Date.now();
    
    // Throttle broadcasts to prevent overwhelming clients
    if (!force && now - this.lastBroadcastTime < this.broadcastThrottleMs) {
      return;
    }
    
    this.lastBroadcastTime = now;

    if (this.clients.size === 0) return;

    try {
      let sentCount = 0;
      const messageCache = new Map<string, string | null>();
      const statsCache = new Map<string, StatsSummary | null>();
      const broadcastTimestamp = new Date().toISOString();
      
      // Send stats to each client based on their subscribed backend
      for (const [ws, clientInfo] of this.clients) {
        if (ws.readyState !== WebSocket.OPEN) {
          continue;
        }

        const cacheKey = this.getBackendCacheKey(clientInfo.backendId);
        let serialized = messageCache.get(cacheKey);

        if (serialized === undefined) {
          let stats = statsCache.get(cacheKey);
          if (stats === undefined) {
            stats = this.getStatsForBackend(clientInfo.backendId);
            statsCache.set(cacheKey, stats);
          }

          serialized = stats ? this.buildStatsMessage(stats, broadcastTimestamp) : null;
          messageCache.set(cacheKey, serialized);
        }

        if (serialized) {
          ws.send(serialized);
          sentCount++;
        }
      }

      if (sentCount > 0) {
        console.log(`[WebSocket] Broadcasted stats to ${sentCount} clients`);
      }
    } catch (err) {
      console.error('[WebSocket] Error broadcasting stats:', err);
    }
  }

  // Get number of connected clients
  getClientCount(): number {
    return this.clients.size;
  }

  stop() {
    this.clients.forEach((info) => info.ws.close());
    this.clients.clear();
    this.wss?.close();
    console.log('[WebSocket] Server stopped');
  }
}
