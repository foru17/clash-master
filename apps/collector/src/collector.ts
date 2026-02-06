import WebSocket from 'ws';
import type { ConnectionsData } from '@clashmaster/shared';
import { StatsDatabase } from './db.js';
import { GeoIPService, type GeoLocation } from './geo-service.js';

interface CollectorOptions {
  url: string;
  token?: string;
  reconnectInterval?: number;
  onData?: (data: ConnectionsData) => void;
  onError?: (error: Error) => void;
}

export class OpenClashCollector {
  private ws: WebSocket | null = null;
  private url: string;
  private token?: string;
  private reconnectInterval: number;
  private onData?: (data: ConnectionsData) => void;
  private onError?: (error: Error) => void;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isClosing = false;
  private backendId: number;

  constructor(backendId: number, options: CollectorOptions) {
    this.backendId = backendId;
    this.url = options.url;
    this.token = options.token;
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.onData = options.onData;
    this.onError = options.onError;
  }

  connect() {
    if (this.isClosing) return;

    console.log(`[Collector:${this.backendId}] Connecting to ${this.url}...`);

    const headers: Record<string, string> = {
      'Origin': this.url.replace('ws://', 'http://').replace('wss://', 'https://'),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    this.ws = new WebSocket(this.url, {
      headers,
      followRedirects: true,
    });

    this.ws.on('open', () => {
      console.log(`[Collector:${this.backendId}] WebSocket connected`);
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const json = JSON.parse(data.toString()) as ConnectionsData;
        this.onData?.(json);
      } catch (err) {
        console.error(`[Collector:${this.backendId}] Failed to parse message:`, err);
      }
    });

    this.ws.on('error', (err) => {
      console.error(`[Collector:${this.backendId}] WebSocket error:`, err.message);
      this.onError?.(err);
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[Collector:${this.backendId}] WebSocket closed: ${code} ${reason}`);
      if (!this.isClosing) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log(`[Collector:${this.backendId}] Reconnecting in ${this.reconnectInterval}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectInterval);
  }

  disconnect() {
    this.isClosing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    console.log(`[Collector:${this.backendId}] Disconnected`);
  }
}

// Track connection state with their accumulated traffic
interface TrackedConnection {
  id: string;
  domain: string;
  ip: string;
  chains: string[];
  lastUpload: number;
  lastDownload: number;
}

export function createCollector(
  db: StatsDatabase, 
  url: string, 
  token?: string,
  geoService?: GeoIPService,
  onTrafficUpdate?: () => void,
  backendId?: number // Backend ID for data isolation
) {
  const id = backendId || 0;
  const activeConnections = new Map<string, TrackedConnection>();
  const geoCache = new Map<string, GeoLocation | null>();
  const pendingGeoLookups = new Map<string, Promise<GeoLocation | null>>();
  const maxGeoCacheEntries = 5000;
  let lastLogTime = 0;
  let lastBroadcastTime = 0;
  const broadcastThrottleMs = 500;

  const rememberGeo = (ip: string, geo: GeoLocation | null) => {
    if (geoCache.has(ip)) {
      geoCache.delete(ip);
    }
    geoCache.set(ip, geo);

    if (geoCache.size > maxGeoCacheEntries) {
      const oldestKey = geoCache.keys().next().value;
      if (oldestKey) {
        geoCache.delete(oldestKey);
      }
    }
  };

  const updateCountryTraffic = (ip: string, upload: number, download: number) => {
    if (!geoService || !ip || (upload === 0 && download === 0)) {
      return;
    }

    const cached = geoCache.get(ip);
    if (cached) {
      db.updateCountryStats(id, cached.country, cached.country_name, cached.continent, upload, download);
      return;
    }
    if (cached === null) {
      return;
    }

    let pending = pendingGeoLookups.get(ip);
    if (!pending) {
      pending = geoService
        .getGeoLocation(ip)
        .then((geo) => {
          rememberGeo(ip, geo);
          return geo;
        })
        .catch(() => {
          rememberGeo(ip, null);
          return null;
        })
        .finally(() => {
          pendingGeoLookups.delete(ip);
        });
      pendingGeoLookups.set(ip, pending);
    }

    pending.then((geo) => {
      if (geo) {
        db.updateCountryStats(id, geo.country, geo.country_name, geo.continent, upload, download);
      }
    }).catch(() => {
      // Ignore geo lookup failures
    });
  };

  return new OpenClashCollector(id, {
    url,
    token,
    onData: (data) => {
      // Validate data format - be more lenient
      if (!data) {
        console.warn(`[Collector:${id}] Received null/undefined data`);
        return;
      }
      
      // Some backends send empty messages or keepalive packets
      if (!data.connections) {
        // Silently ignore - this is normal for some backends
        return;
      }
      
      if (!Array.isArray(data.connections)) {
        console.warn(`[Collector:${id}] Invalid connections format: ${typeof data.connections}`);
        return;
      }
      
      const now = Date.now();
      const currentIds = new Set(data.connections.map(c => c?.id).filter(Boolean));
      const trafficUpdates: Array<{
        domain: string;
        ip: string;
        chain: string;
        chains: string[];
        upload: number;
        download: number;
      }> = [];
      const countryUpdates: Array<{ ip: string; upload: number; download: number }> = [];
      let hasNewTraffic = false;
      
      // Process all current connections
      for (const conn of data.connections) {
        // Skip invalid connection entries - be more lenient
        if (!conn || typeof conn !== 'object') {
          continue;
        }
        
        // Some backends may not have all fields
        if (!conn.id) {
          continue;
        }
        
        // Ensure metadata exists with defaults
        const metadata = conn.metadata || {};
        const domain = metadata.host || metadata.sniffHost || '';
        const ip = metadata.destinationIP || '';
        const chains = Array.isArray(conn.chains) ? conn.chains : ['DIRECT'];
        
        const existing = activeConnections.get(conn.id);
        
        if (!existing) {
          // New connection - track it and record initial traffic
          activeConnections.set(conn.id, {
            id: conn.id,
            domain,
            ip,
            chains,
            lastUpload: conn.upload,
            lastDownload: conn.download,
          });
          
          // Record initial traffic for new connection
          if (conn.upload > 0 || conn.download > 0) {
            trafficUpdates.push({
              domain,
              ip,
              chain: chains[0] || 'DIRECT',
              chains,
              upload: conn.upload,
              download: conn.download,
            });
            countryUpdates.push({ ip, upload: conn.upload, download: conn.download });
            hasNewTraffic = true;
          }
        } else {
          // Keep latest metadata for long-lived connections
          if (domain) {
            existing.domain = domain;
          }
          if (ip) {
            existing.ip = ip;
          }
          if (chains.length > 0) {
            existing.chains = chains;
          }

          // Existing connection - calculate delta and update stats
          const uploadDelta = Math.max(0, conn.upload - existing.lastUpload);
          const downloadDelta = Math.max(0, conn.download - existing.lastDownload);
          
          if (uploadDelta > 0 || downloadDelta > 0) {
            trafficUpdates.push({
              domain: existing.domain,
              ip: existing.ip,
              chain: existing.chains[0] || 'DIRECT',
              chains: existing.chains,
              upload: uploadDelta,
              download: downloadDelta,
            });
            countryUpdates.push({ ip: existing.ip, upload: uploadDelta, download: downloadDelta });
            
            existing.lastUpload = conn.upload;
            existing.lastDownload = conn.download;
            hasNewTraffic = true;
          }
        }
      }

      if (trafficUpdates.length > 0) {
        db.updateTrafficStatsBatch(id, trafficUpdates);
        for (const update of countryUpdates) {
          updateCountryTraffic(update.ip, update.upload, update.download);
        }
      }
      
      // Find closed connections and flush their remaining traffic
      for (const [connId] of activeConnections) {
        if (!currentIds.has(connId)) {
          // Connection closed - any remaining traffic was already counted
          activeConnections.delete(connId);
        }
      }
      
      // Broadcast to WebSocket clients if there's new traffic (with throttling)
      if (hasNewTraffic && onTrafficUpdate && now - lastBroadcastTime > broadcastThrottleMs) {
        lastBroadcastTime = now;
        onTrafficUpdate();
      }
      
      // Log stats periodically (every 10 seconds)
      if (now - lastLogTime > 10000) {
        const domains = new Set<string>();
        const rules = new Set<string>();
        
        for (const conn of activeConnections.values()) {
          if (conn.domain) domains.add(conn.domain);
          // The initial rule is the last element in chains array
          const initialRule = conn.chains.length > 0 ? conn.chains[conn.chains.length - 1] : 'DIRECT';
          rules.add(initialRule);
        }
        
        console.log(`[Collector:${id}] Active: ${activeConnections.size}, Domains: ${domains.size}, Rules: ${rules.size}`);
        lastLogTime = now;
      }
    },
    onError: (err) => {
      console.error(`[Collector:${id}] Error:`, err);
    }
  });
}
