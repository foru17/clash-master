import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { Connection, DomainStats, IPStats, HourlyStats, DailyStats, ProxyStats, RuleStats } from '@clashmaster/shared';

export interface TrafficUpdate {
  domain: string;
  ip: string;
  chain: string;
  chains: string[];
  upload: number;
  download: number;
}

export interface BackendConfig {
  id: number;
  name: string;
  url: string;
  token: string;
  enabled: boolean;
  is_active: boolean;
  listening: boolean;
  created_at: string;
  updated_at: string;
}

interface NormalizedTrafficUpdate {
  backendId: number;
  domain: string;
  ip: string;
  chain: string;
  rule: string;
  finalProxy: string;
  upload: number;
  download: number;
  timestamp: string;
  hour: string;
  mapRule?: string;
  mapProxy?: string;
}

export class StatsDatabase {
  private db: Database.Database;
  private dbPath: string;
  private domainUpsertStmt!: Database.Statement;
  private ipUpsertStmt!: Database.Statement;
  private proxyUpsertStmt!: Database.Statement;
  private ruleUpsertStmt!: Database.Statement;
  private ruleProxyInsertStmt!: Database.Statement;
  private hourlyUpsertStmt!: Database.Statement;
  private connectionLogInsertStmt!: Database.Statement;
  private writeTrafficTx!: (payload: NormalizedTrafficUpdate) => void;
  private writeTrafficBatchTx!: (payloads: NormalizedTrafficUpdate[]) => void;

  constructor(dbPath = 'stats.db') {
    this.dbPath = path.resolve(dbPath);
    this.db = new Database(this.dbPath);
    this.init();
    this.prepareTrafficStatements();
  }

  private init() {
    // Domain statistics - aggregated by domain per backend
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS domain_stats (
        backend_id INTEGER NOT NULL,
        domain TEXT NOT NULL,
        ips TEXT,
        total_upload INTEGER DEFAULT 0,
        total_download INTEGER DEFAULT 0,
        total_connections INTEGER DEFAULT 0,
        last_seen DATETIME,
        rules TEXT,
        chains TEXT,
        PRIMARY KEY (backend_id, domain),
        FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
      );
    `);

    // IP statistics per backend
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ip_stats (
        backend_id INTEGER NOT NULL,
        ip TEXT NOT NULL,
        domains TEXT,
        total_upload INTEGER DEFAULT 0,
        total_download INTEGER DEFAULT 0,
        total_connections INTEGER DEFAULT 0,
        last_seen DATETIME,
        asn TEXT,
        geoip TEXT,
        PRIMARY KEY (backend_id, ip),
        FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
      );
    `);

    // Proxy/Chain statistics per backend
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS proxy_stats (
        backend_id INTEGER NOT NULL,
        chain TEXT NOT NULL,
        total_upload INTEGER DEFAULT 0,
        total_download INTEGER DEFAULT 0,
        total_connections INTEGER DEFAULT 0,
        last_seen DATETIME,
        PRIMARY KEY (backend_id, chain),
        FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
      );
    `);

    // Rule statistics per backend
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rule_stats (
        backend_id INTEGER NOT NULL,
        rule TEXT NOT NULL,
        final_proxy TEXT,
        total_upload INTEGER DEFAULT 0,
        total_download INTEGER DEFAULT 0,
        total_connections INTEGER DEFAULT 0,
        last_seen DATETIME,
        PRIMARY KEY (backend_id, rule),
        FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
      );
    `);

    // Rule to proxy mapping per backend
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rule_proxy_map (
        backend_id INTEGER NOT NULL,
        rule TEXT,
        proxy TEXT,
        PRIMARY KEY (backend_id, rule, proxy),
        FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
      );
    `);

    // ASN cache
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS asn_cache (
        ip TEXT PRIMARY KEY,
        asn TEXT,
        org TEXT,
        queried_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // GeoIP cache
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS geoip_cache (
        ip TEXT PRIMARY KEY,
        country TEXT,
        country_name TEXT,
        city TEXT,
        asn TEXT,
        as_name TEXT,
        as_domain TEXT,
        continent TEXT,
        continent_name TEXT,
        queried_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Country traffic statistics per backend
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS country_stats (
        backend_id INTEGER NOT NULL,
        country TEXT NOT NULL,
        country_name TEXT,
        continent TEXT,
        total_upload INTEGER DEFAULT 0,
        total_download INTEGER DEFAULT 0,
        total_connections INTEGER DEFAULT 0,
        last_seen DATETIME,
        PRIMARY KEY (backend_id, country),
        FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
      );
    `);

    // Hourly aggregation per backend
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hourly_stats (
        backend_id INTEGER NOT NULL,
        hour TEXT NOT NULL,
        upload INTEGER DEFAULT 0,
        download INTEGER DEFAULT 0,
        connections INTEGER DEFAULT 0,
        PRIMARY KEY (backend_id, hour),
        FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
      );
    `);

    // Connection log per backend
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS connection_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        backend_id INTEGER NOT NULL,
        domain TEXT,
        ip TEXT,
        chain TEXT,
        upload INTEGER DEFAULT 0,
        download INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
      );
    `);

    // Create indexes
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_domain_stats_backend ON domain_stats(backend_id);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_domain_stats_traffic ON domain_stats(total_download + total_upload);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_ip_stats_backend ON ip_stats(backend_id);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_ip_stats_traffic ON ip_stats(total_download + total_upload);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_proxy_stats_backend ON proxy_stats(backend_id);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_proxy_stats_traffic ON proxy_stats(total_download + total_upload);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_rule_stats_backend ON rule_stats(backend_id);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_rule_stats_traffic ON rule_stats(total_download + total_upload);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_rule_proxy_map ON rule_proxy_map(backend_id, rule, proxy);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_country_stats_backend ON country_stats(backend_id);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_hourly_stats_backend ON hourly_stats(backend_id);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_connection_logs_backend ON connection_logs(backend_id);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_connection_logs_timestamp ON connection_logs(timestamp);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_connection_logs_domain ON connection_logs(domain);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_connection_logs_chain ON connection_logs(chain);`);

    // Backend configurations - stores OpenClash backend connections
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS backend_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        token TEXT DEFAULT '',
        enabled BOOLEAN DEFAULT 1,
        is_active BOOLEAN DEFAULT 0,
        listening BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create unique index on name
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_backend_configs_name ON backend_configs(name);`);

    // Migrate existing data if needed (from single-backend schema)
    this.migrateIfNeeded();
  }

  private prepareTrafficStatements() {
    this.domainUpsertStmt = this.db.prepare(`
      INSERT INTO domain_stats (backend_id, domain, ips, total_upload, total_download, total_connections, last_seen, rules, chains)
      VALUES (@backendId, @domain, @ip, @upload, @download, 1, @timestamp, @rule, @chain)
      ON CONFLICT(backend_id, domain) DO UPDATE SET
        ips = CASE
          WHEN domain_stats.ips IS NULL THEN @ip
          WHEN INSTR(domain_stats.ips, @ip) > 0 THEN domain_stats.ips
          ELSE domain_stats.ips || ',' || @ip
        END,
        total_upload = total_upload + @upload,
        total_download = total_download + @download,
        total_connections = total_connections + 1,
        last_seen = @timestamp,
        rules = CASE
          WHEN domain_stats.rules IS NULL THEN @rule
          WHEN INSTR(domain_stats.rules, @rule) > 0 THEN domain_stats.rules
          ELSE domain_stats.rules || ',' || @rule
        END,
        chains = CASE
          WHEN domain_stats.chains IS NULL THEN @chain
          WHEN INSTR(domain_stats.chains, @chain) > 0 THEN domain_stats.chains
          ELSE domain_stats.chains || ',' || @chain
        END
    `);

    this.ipUpsertStmt = this.db.prepare(`
      INSERT INTO ip_stats (backend_id, ip, domains, total_upload, total_download, total_connections, last_seen)
      VALUES (@backendId, @ip, @domain, @upload, @download, 1, @timestamp)
      ON CONFLICT(backend_id, ip) DO UPDATE SET
        domains = CASE
          WHEN ip_stats.domains IS NULL THEN @domain
          WHEN INSTR(ip_stats.domains, @domain) > 0 THEN ip_stats.domains
          ELSE ip_stats.domains || ',' || @domain
        END,
        total_upload = total_upload + @upload,
        total_download = total_download + @download,
        total_connections = total_connections + 1,
        last_seen = @timestamp
    `);

    this.proxyUpsertStmt = this.db.prepare(`
      INSERT INTO proxy_stats (backend_id, chain, total_upload, total_download, total_connections, last_seen)
      VALUES (@backendId, @chain, @upload, @download, 1, @timestamp)
      ON CONFLICT(backend_id, chain) DO UPDATE SET
        total_upload = total_upload + @upload,
        total_download = total_download + @download,
        total_connections = total_connections + 1,
        last_seen = @timestamp
    `);

    this.ruleUpsertStmt = this.db.prepare(`
      INSERT INTO rule_stats (backend_id, rule, final_proxy, total_upload, total_download, total_connections, last_seen)
      VALUES (@backendId, @rule, @finalProxy, @upload, @download, 1, @timestamp)
      ON CONFLICT(backend_id, rule) DO UPDATE SET
        final_proxy = @finalProxy,
        total_upload = total_upload + @upload,
        total_download = total_download + @download,
        total_connections = total_connections + 1,
        last_seen = @timestamp
    `);

    this.ruleProxyInsertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO rule_proxy_map (backend_id, rule, proxy)
      VALUES (@backendId, @rule, @proxy)
    `);

    this.hourlyUpsertStmt = this.db.prepare(`
      INSERT INTO hourly_stats (backend_id, hour, upload, download, connections)
      VALUES (@backendId, @hour, @upload, @download, 1)
      ON CONFLICT(backend_id, hour) DO UPDATE SET
        upload = upload + @upload,
        download = download + @download,
        connections = connections + 1
    `);

    this.connectionLogInsertStmt = this.db.prepare(`
      INSERT INTO connection_logs (backend_id, domain, ip, chain, upload, download)
      VALUES (@backendId, @domain, @ip, @chain, @upload, @download)
    `);

    this.writeTrafficTx = this.db.transaction((payload: NormalizedTrafficUpdate) => {
      this.applyTrafficUpdate(payload);
    });

    this.writeTrafficBatchTx = this.db.transaction((payloads: NormalizedTrafficUpdate[]) => {
      for (const payload of payloads) {
        this.applyTrafficUpdate(payload);
      }
    });
  }

  private buildTrafficPayload(
    backendId: number,
    update: TrafficUpdate,
    timestamp: string,
    hour: string
  ): NormalizedTrafficUpdate | null {
    if (update.upload === 0 && update.download === 0) {
      return null;
    }

    const rule = update.chains.length > 0 ? update.chains[update.chains.length - 1] : 'DIRECT';
    const finalProxy = update.chains.length > 0 ? update.chains[0] : 'DIRECT';
    const hasRuleProxy = update.chains.length > 1;

    return {
      backendId,
      domain: update.domain || 'unknown',
      ip: update.ip,
      chain: update.chain || finalProxy,
      rule,
      finalProxy,
      upload: update.upload,
      download: update.download,
      timestamp,
      hour,
      mapRule: hasRuleProxy ? update.chains[update.chains.length - 1] : undefined,
      mapProxy: hasRuleProxy ? update.chains[0] : undefined,
    };
  }

  private applyTrafficUpdate(payload: NormalizedTrafficUpdate) {
    if (payload.domain !== 'unknown') {
      this.domainUpsertStmt.run({
        backendId: payload.backendId,
        domain: payload.domain,
        ip: payload.ip,
        upload: payload.upload,
        download: payload.download,
        timestamp: payload.timestamp,
        rule: payload.rule,
        chain: payload.chain,
      });
    }

    this.ipUpsertStmt.run({
      backendId: payload.backendId,
      ip: payload.ip,
      domain: payload.domain,
      upload: payload.upload,
      download: payload.download,
      timestamp: payload.timestamp,
    });

    this.proxyUpsertStmt.run({
      backendId: payload.backendId,
      chain: payload.chain,
      upload: payload.upload,
      download: payload.download,
      timestamp: payload.timestamp,
    });

    this.ruleUpsertStmt.run({
      backendId: payload.backendId,
      rule: payload.rule,
      finalProxy: payload.finalProxy,
      upload: payload.upload,
      download: payload.download,
      timestamp: payload.timestamp,
    });

    if (payload.mapRule && payload.mapProxy) {
      this.ruleProxyInsertStmt.run({
        backendId: payload.backendId,
        rule: payload.mapRule,
        proxy: payload.mapProxy,
      });
    }

    this.hourlyUpsertStmt.run({
      backendId: payload.backendId,
      hour: payload.hour,
      upload: payload.upload,
      download: payload.download,
    });

    this.connectionLogInsertStmt.run({
      backendId: payload.backendId,
      domain: payload.domain,
      ip: payload.ip,
      chain: payload.chain,
      upload: payload.upload,
      download: payload.download,
    });
  }

  // Migrate from old single-backend schema to multi-backend schema
  private migrateIfNeeded() {
    // Check if we need to migrate by checking if there's data without backend_id
    const needsMigration = this.db.prepare(`
      SELECT 1 FROM sqlite_master 
      WHERE type='table' AND name='domain_stats'
    `).get() as { '1': number } | undefined;

    if (!needsMigration) return;

    // Check if domain_stats table has backend_id column
    const tableInfo = this.db.prepare(`PRAGMA table_info(domain_stats)`).all() as { name: string }[];
    const hasBackendId = tableInfo.some(col => col.name === 'backend_id');

    if (!hasBackendId) {
      console.log('[DB] Migrating from single-backend to multi-backend schema...');
      this.performMigration();
    }

    // Check if backend_configs has listening column
    const backendInfo = this.db.prepare(`PRAGMA table_info(backend_configs)`).all() as { name: string }[];
    const hasListening = backendInfo.some(col => col.name === 'listening');

    if (!hasListening) {
      console.log('[DB] Adding listening column to backend_configs...');
      this.db.exec(`ALTER TABLE backend_configs ADD COLUMN listening BOOLEAN DEFAULT 1;`);
    }
  }

  private performMigration() {
    // Create temporary tables with new schema and migrate data
    // This is a complex migration - we'll create a default backend and associate all data with it

    this.db.exec(`BEGIN TRANSACTION;`);

    try {
      // Create a default backend if none exists
      const existingBackend = this.db.prepare(`SELECT id FROM backend_configs LIMIT 1`).get() as { id: number } | undefined;
      let defaultBackendId: number;

      if (!existingBackend) {
        const result = this.db.prepare(`
          INSERT INTO backend_configs (name, url, token, enabled, is_active, listening)
          VALUES ('Default', 'http://192.168.1.1:9090', '', 1, 1, 1)
        `).run();
        defaultBackendId = Number(result.lastInsertRowid);
      } else {
        defaultBackendId = existingBackend.id;
      }

      // Migrate domain_stats - recreate table with new schema
      this.db.exec(`
        CREATE TABLE domain_stats_new (
          backend_id INTEGER NOT NULL,
          domain TEXT NOT NULL,
          ips TEXT,
          total_upload INTEGER DEFAULT 0,
          total_download INTEGER DEFAULT 0,
          total_connections INTEGER DEFAULT 0,
          last_seen DATETIME,
          rules TEXT,
          chains TEXT,
          PRIMARY KEY (backend_id, domain),
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO domain_stats_new 
        SELECT ${defaultBackendId} as backend_id, domain, ips, total_upload, total_download, 
               total_connections, last_seen, rules, chains 
        FROM domain_stats;
      `);
      this.db.exec(`DROP TABLE domain_stats;`);
      this.db.exec(`ALTER TABLE domain_stats_new RENAME TO domain_stats;`);

      // Migrate ip_stats
      this.db.exec(`
        CREATE TABLE ip_stats_new (
          backend_id INTEGER NOT NULL,
          ip TEXT NOT NULL,
          domains TEXT,
          total_upload INTEGER DEFAULT 0,
          total_download INTEGER DEFAULT 0,
          total_connections INTEGER DEFAULT 0,
          last_seen DATETIME,
          asn TEXT,
          geoip TEXT,
          PRIMARY KEY (backend_id, ip),
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO ip_stats_new 
        SELECT ${defaultBackendId} as backend_id, ip, domains, total_upload, total_download, 
               total_connections, last_seen, asn, geoip 
        FROM ip_stats;
      `);
      this.db.exec(`DROP TABLE ip_stats;`);
      this.db.exec(`ALTER TABLE ip_stats_new RENAME TO ip_stats;`);

      // Migrate proxy_stats
      this.db.exec(`
        CREATE TABLE proxy_stats_new (
          backend_id INTEGER NOT NULL,
          chain TEXT NOT NULL,
          total_upload INTEGER DEFAULT 0,
          total_download INTEGER DEFAULT 0,
          total_connections INTEGER DEFAULT 0,
          last_seen DATETIME,
          PRIMARY KEY (backend_id, chain),
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO proxy_stats_new 
        SELECT ${defaultBackendId} as backend_id, chain, total_upload, total_download, 
               total_connections, last_seen 
        FROM proxy_stats;
      `);
      this.db.exec(`DROP TABLE proxy_stats;`);
      this.db.exec(`ALTER TABLE proxy_stats_new RENAME TO proxy_stats;`);

      // Migrate rule_stats
      this.db.exec(`
        CREATE TABLE rule_stats_new (
          backend_id INTEGER NOT NULL,
          rule TEXT NOT NULL,
          final_proxy TEXT,
          total_upload INTEGER DEFAULT 0,
          total_download INTEGER DEFAULT 0,
          total_connections INTEGER DEFAULT 0,
          last_seen DATETIME,
          PRIMARY KEY (backend_id, rule),
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO rule_stats_new 
        SELECT ${defaultBackendId} as backend_id, rule, final_proxy, total_upload, total_download, 
               total_connections, last_seen 
        FROM rule_stats;
      `);
      this.db.exec(`DROP TABLE rule_stats;`);
      this.db.exec(`ALTER TABLE rule_stats_new RENAME TO rule_stats;`);

      // Migrate rule_proxy_map
      this.db.exec(`
        CREATE TABLE rule_proxy_map_new (
          backend_id INTEGER NOT NULL,
          rule TEXT,
          proxy TEXT,
          PRIMARY KEY (backend_id, rule, proxy),
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO rule_proxy_map_new 
        SELECT ${defaultBackendId} as backend_id, rule, proxy 
        FROM rule_proxy_map;
      `);
      this.db.exec(`DROP TABLE rule_proxy_map;`);
      this.db.exec(`ALTER TABLE rule_proxy_map_new RENAME TO rule_proxy_map;`);

      // Migrate country_stats
      this.db.exec(`
        CREATE TABLE country_stats_new (
          backend_id INTEGER NOT NULL,
          country TEXT NOT NULL,
          country_name TEXT,
          continent TEXT,
          total_upload INTEGER DEFAULT 0,
          total_download INTEGER DEFAULT 0,
          total_connections INTEGER DEFAULT 0,
          last_seen DATETIME,
          PRIMARY KEY (backend_id, country),
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO country_stats_new 
        SELECT ${defaultBackendId} as backend_id, country, country_name, continent, total_upload, 
               total_download, total_connections, last_seen 
        FROM country_stats;
      `);
      this.db.exec(`DROP TABLE country_stats;`);
      this.db.exec(`ALTER TABLE country_stats_new RENAME TO country_stats;`);

      // Migrate hourly_stats
      this.db.exec(`
        CREATE TABLE hourly_stats_new (
          backend_id INTEGER NOT NULL,
          hour TEXT NOT NULL,
          upload INTEGER DEFAULT 0,
          download INTEGER DEFAULT 0,
          connections INTEGER DEFAULT 0,
          PRIMARY KEY (backend_id, hour),
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO hourly_stats_new 
        SELECT ${defaultBackendId} as backend_id, hour, upload, download, connections 
        FROM hourly_stats;
      `);
      this.db.exec(`DROP TABLE hourly_stats;`);
      this.db.exec(`ALTER TABLE hourly_stats_new RENAME TO hourly_stats;`);

      // Migrate connection_logs
      this.db.exec(`
        CREATE TABLE connection_logs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          backend_id INTEGER NOT NULL,
          domain TEXT,
          ip TEXT,
          chain TEXT,
          upload INTEGER DEFAULT 0,
          download INTEGER DEFAULT 0,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO connection_logs_new (id, backend_id, domain, ip, chain, upload, download, timestamp)
        SELECT id, ${defaultBackendId} as backend_id, domain, ip, chain, upload, download, timestamp 
        FROM connection_logs;
      `);
      this.db.exec(`DROP TABLE connection_logs;`);
      this.db.exec(`ALTER TABLE connection_logs_new RENAME TO connection_logs;`);

      this.db.exec(`COMMIT;`);
      console.log('[DB] Migration completed successfully');
    } catch (error) {
      this.db.exec(`ROLLBACK;`);
      console.error('[DB] Migration failed:', error);
      throw error;
    }
  }

  // Update traffic stats with delta values for a specific backend
  updateTrafficStats(backendId: number, update: TrafficUpdate) {
    const timestamp = new Date().toISOString();
    const hour = timestamp.slice(0, 13) + ':00:00';
    const payload = this.buildTrafficPayload(backendId, update, timestamp, hour);
    if (!payload) {
      return;
    }

    this.writeTrafficTx(payload);
  }

  // Batch write traffic updates in one transaction for high-frequency websocket frames
  updateTrafficStatsBatch(backendId: number, updates: TrafficUpdate[]) {
    if (updates.length === 0) {
      return;
    }

    const timestamp = new Date().toISOString();
    const hour = timestamp.slice(0, 13) + ':00:00';
    const payloads: NormalizedTrafficUpdate[] = [];

    for (const update of updates) {
      const payload = this.buildTrafficPayload(backendId, update, timestamp, hour);
      if (payload) {
        payloads.push(payload);
      }
    }

    if (payloads.length === 0) {
      return;
    }

    this.writeTrafficBatchTx(payloads);
  }

  // Get all domain stats for a specific backend
  getDomainStats(backendId: number, limit = 100): DomainStats[] {
    const stmt = this.db.prepare(`
      SELECT domain, total_upload as totalUpload, total_download as totalDownload, 
             total_connections as totalConnections, last_seen as lastSeen, ips, rules, chains
      FROM domain_stats
      WHERE backend_id = ?
      ORDER BY (total_upload + total_download) DESC
      LIMIT ?
    `);
    const rows = stmt.all(backendId, limit) as Array<{
      domain: string;
      totalUpload: number;
      totalDownload: number;
      totalConnections: number;
      lastSeen: string;
      ips: string | null;
      rules: string | null;
      chains: string | null;
    }>;
    
    return rows.map(row => ({
      ...row,
      ips: row.ips ? row.ips.split(',') : [],
      rules: row.rules ? row.rules.split(',') : [],
      chains: row.chains ? row.chains.split(',') : [],
    })) as DomainStats[];
  }

  // Get all IP stats for a specific backend
  getIPStats(backendId: number, limit = 100): IPStats[] {
    const stmt = this.db.prepare(`
      SELECT 
        i.ip, 
        i.domains, 
        i.total_upload as totalUpload, 
        i.total_download as totalDownload, 
        i.total_connections as totalConnections, 
        i.last_seen as lastSeen,
        COALESCE(i.asn, g.asn) as asn,
        CASE 
          WHEN g.country IS NOT NULL THEN 
            json_array(
              COALESCE(g.country_name, g.country),
              COALESCE(g.city, ''),
              COALESCE(g.as_name, '')
            )
          WHEN i.geoip IS NOT NULL THEN 
            json(i.geoip)
          ELSE 
            NULL
        END as geoIP
      FROM ip_stats i
      LEFT JOIN geoip_cache g ON i.ip = g.ip
      WHERE i.backend_id = ?
      ORDER BY (i.total_upload + i.total_download) DESC
      LIMIT ?
    `);
    const rows = stmt.all(backendId, limit) as Array<{
      ip: string;
      domains: string;
      totalUpload: number;
      totalDownload: number;
      totalConnections: number;
      lastSeen: string;
      asn: string | null;
      geoIP: string | null;
    }>;
    
    return rows.map(row => ({
      ...row,
      domains: row.domains ? row.domains.split(',') : [],
      geoIP: row.geoIP ? JSON.parse(row.geoIP).filter(Boolean) : undefined,
      asn: row.asn || undefined,
    })) as IPStats[];
  }

  // Get hourly stats for a specific backend
  getHourlyStats(backendId: number, hours = 24): HourlyStats[] {
    const stmt = this.db.prepare(`
      SELECT hour, upload, download, connections
      FROM hourly_stats
      WHERE backend_id = ?
      ORDER BY hour DESC
      LIMIT ?
    `);
    return stmt.all(backendId, hours) as HourlyStats[];
  }

  // Get today's traffic for a specific backend
  getTodayTraffic(backendId: number): { upload: number; download: number } {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(upload), 0) as upload, COALESCE(SUM(download), 0) as download
      FROM hourly_stats
      WHERE backend_id = ? AND hour >= ?
    `);
    return stmt.get(backendId, today) as { upload: number; download: number };
  }

  // Get traffic trend for a specific backend (for time range selection)
  getTrafficTrend(backendId: number, minutes = 30): Array<{ time: string; upload: number; download: number }> {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    const stmt = this.db.prepare(`
      SELECT strftime('%Y-%m-%dT%H:%M:%S', timestamp) as time, upload, download
      FROM connection_logs
      WHERE backend_id = ? AND datetime(timestamp) > datetime(?)
      ORDER BY timestamp ASC
    `);
    return stmt.all(backendId, cutoff) as Array<{ time: string; upload: number; download: number }>;
  }

  // Get traffic trend aggregated by time buckets for chart display
  getTrafficTrendAggregated(backendId: number, minutes = 30, bucketMinutes = 1): Array<{ time: string; upload: number; download: number }> {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    
    // SQLite datetime formatting for bucketing
    // Use strftime to bucket by minute intervals
    const bucketExpr = bucketMinutes === 1 
      ? `strftime('%Y-%m-%dT%H:%M:00', datetime(timestamp))`
      : `strftime('%Y-%m-%dT%H:%M:00', datetime((strftime('%s', datetime(timestamp)) / ${bucketMinutes * 60}) * ${bucketMinutes * 60}, 'unixepoch'))`;

    const stmt = this.db.prepare(`
      SELECT 
        ${bucketExpr} as time,
        SUM(upload) as upload,
        SUM(download) as download
      FROM connection_logs
      WHERE backend_id = ? AND datetime(timestamp) > datetime(?)
      GROUP BY ${bucketExpr}
      ORDER BY time ASC
    `);
    return stmt.all(backendId, cutoff) as Array<{ time: string; upload: number; download: number }>;
  }

  // Get country stats for a specific backend
  getCountryStats(backendId: number): Array<{ country: string; countryName: string; continent: string; totalUpload: number; totalDownload: number; totalConnections: number }> {
    const stmt = this.db.prepare(`
      SELECT country, country_name as countryName, continent, 
             total_upload as totalUpload, total_download as totalDownload, 
             total_connections as totalConnections
      FROM country_stats
      WHERE backend_id = ?
      ORDER BY (total_upload + total_download) DESC
    `);
    return stmt.all(backendId) as Array<{ country: string; countryName: string; continent: string; totalUpload: number; totalDownload: number; totalConnections: number }>;
  }

  // Update country stats for a specific backend
  updateCountryStats(backendId: number, country: string, countryName: string, continent: string, upload: number, download: number) {
    const stmt = this.db.prepare(`
      INSERT INTO country_stats (backend_id, country, country_name, continent, total_upload, total_download, total_connections, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(backend_id, country) DO UPDATE SET
        total_upload = total_upload + ?,
        total_download = total_download + ?,
        total_connections = total_connections + 1,
        last_seen = CURRENT_TIMESTAMP
    `);
    stmt.run(backendId, country, countryName, continent, upload, download, upload, download);
  }

  // Get top domains for a specific backend
  getTopDomains(backendId: number, limit = 10): DomainStats[] {
    return this.getDomainStats(backendId, limit);
  }

  // Get top IPs for a specific backend
  getTopIPs(backendId: number, limit = 10): IPStats[] {
    return this.getIPStats(backendId, limit);
  }

  // Get proxy stats for a specific backend
  getProxyStats(backendId: number): ProxyStats[] {
    const stmt = this.db.prepare(`
      SELECT chain, total_upload as totalUpload, total_download as totalDownload, 
             total_connections as totalConnections, last_seen as lastSeen
      FROM proxy_stats
      WHERE backend_id = ?
      ORDER BY (total_upload + total_download) DESC
    `);
    return stmt.all(backendId) as ProxyStats[];
  }

  // Get rule stats for a specific backend
  getRuleStats(backendId: number): RuleStats[] {
    const stmt = this.db.prepare(`
      SELECT rule, final_proxy as finalProxy, total_upload as totalUpload, total_download as totalDownload, 
             total_connections as totalConnections, last_seen as lastSeen
      FROM rule_stats
      WHERE backend_id = ?
      ORDER BY (total_upload + total_download) DESC
    `);
    return stmt.all(backendId) as RuleStats[];
  }

  // Get rule-proxy mapping for a specific backend
  getRuleProxyMap(backendId: number): Array<{ rule: string; proxies: string[] }> {
    const stmt = this.db.prepare(`
      SELECT rule, proxy FROM rule_proxy_map WHERE backend_id = ? ORDER BY rule, proxy
    `);
    const rows = stmt.all(backendId) as Array<{ rule: string; proxy: string }>;
    
    const map = new Map<string, string[]>();
    for (const row of rows) {
      if (!map.has(row.rule)) {
        map.set(row.rule, []);
      }
      map.get(row.rule)!.push(row.proxy);
    }
    
    return Array.from(map.entries()).map(([rule, proxies]) => ({ rule, proxies }));
  }

  // Update ASN info for an IP
  updateASNInfo(ip: string, asn: string, org: string) {
    const stmt = this.db.prepare(`
      INSERT INTO asn_cache (ip, asn, org, queried_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(ip) DO UPDATE SET
        asn = ?,
        org = ?,
        queried_at = CURRENT_TIMESTAMP
    `);
    stmt.run(ip, asn, org, asn, org);
  }

  // Get ASN info for IPs
  getASNInfo(ips: string[]): Array<{ ip: string; asn: string; org: string }> {
    const stmt = this.db.prepare(`
      SELECT ip, asn, org FROM asn_cache WHERE ip IN (${ips.map(() => '?').join(',')})
    `);
    return stmt.all(...ips) as Array<{ ip: string; asn: string; org: string }>;
  }

  // Get ASN info for a single IP
  getASNInfoForIP(ip: string): { ip: string; asn: string; org: string } | undefined {
    const stmt = this.db.prepare(`SELECT ip, asn, org FROM asn_cache WHERE ip = ?`);
    return stmt.get(ip) as { ip: string; asn: string; org: string } | undefined;
  }

  // Get GeoIP info for an IP (from cache)
  getIPGeolocation(ip: string): { 
    country: string; 
    country_name: string; 
    city: string;
    asn: string;
    as_name: string;
    as_domain: string;
    continent: string;
    continent_name: string;
  } | undefined {
    const stmt = this.db.prepare(`
      SELECT country, country_name, city, asn, as_name, as_domain, continent, continent_name 
      FROM geoip_cache 
      WHERE ip = ?
    `);
    return stmt.get(ip) as { 
      country: string; 
      country_name: string; 
      city: string;
      asn: string;
      as_name: string;
      as_domain: string;
      continent: string;
      continent_name: string;
    } | undefined;
  }

  // Save GeoIP info to cache
  saveIPGeolocation(ip: string, geo: {
    country: string;
    country_name: string;
    city: string;
    asn: string;
    as_name: string;
    as_domain: string;
    continent: string;
    continent_name: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO geoip_cache (ip, country, country_name, city, asn, as_name, as_domain, continent, continent_name, queried_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(ip) DO UPDATE SET
        country = ?,
        country_name = ?,
        city = ?,
        asn = ?,
        as_name = ?,
        as_domain = ?,
        continent = ?,
        continent_name = ?,
        queried_at = CURRENT_TIMESTAMP
    `);
    stmt.run(
      ip, geo.country, geo.country_name, geo.city, geo.asn, geo.as_name, geo.as_domain, geo.continent, geo.continent_name,
      geo.country, geo.country_name, geo.city, geo.asn, geo.as_name, geo.as_domain, geo.continent, geo.continent_name
    );
  }

  // Get summary stats for a specific backend
  getSummary(backendId: number): { totalConnections: number; totalUpload: number; totalDownload: number; uniqueDomains: number; uniqueIPs: number } {
    const trafficStmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(connections), 0) as totalConnections,
        COALESCE(SUM(upload), 0) as upload,
        COALESCE(SUM(download), 0) as download
      FROM hourly_stats
      WHERE backend_id = ?
    `);
    const { totalConnections, upload, download } = trafficStmt.get(backendId) as {
      totalConnections: number;
      upload: number;
      download: number;
    };

    const domainsStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM domain_stats WHERE backend_id = ?
    `);
    const uniqueDomains = (domainsStmt.get(backendId) as { count: number }).count;

    const ipsStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM ip_stats WHERE backend_id = ?
    `);
    const uniqueIPs = (ipsStmt.get(backendId) as { count: number }).count;

    return {
      totalConnections,
      totalUpload: upload,
      totalDownload: download,
      uniqueDomains,
      uniqueIPs
    };
  }

  // Get recent connections for a specific backend
  getRecentConnections(backendId: number, limit = 100): Connection[] {
    const stmt = this.db.prepare(`
      SELECT id, domain, ip, chain, upload, download, timestamp
      FROM connection_logs
      WHERE backend_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    return stmt.all(backendId, limit) as Connection[];
  }

  // Clean old data for a specific backend (or all backends if backendId is null)
  // days=0 means clear all data (no time limit)
  cleanupOldData(backendId: number | null, days: number): { deletedConnections: number; deletedLogs: number; deletedDomains: number; deletedIPs: number; deletedProxies: number; deletedRules: number } {
    let deletedConnections = 0;
    let deletedLogs = 0;
    let deletedDomains = 0;
    let deletedIPs = 0;
    let deletedProxies = 0;
    let deletedRules = 0;

    if (backendId !== null) {
      // Clean specific backend
      if (days === 0) {
        // Clear all data for this backend
        const connectionsStmt = this.db.prepare(`DELETE FROM connection_logs WHERE backend_id = ?`);
        const result = connectionsStmt.run(backendId);
        deletedConnections = result.changes;
        deletedLogs = result.changes;

        // Clear stats tables
        const domainsStmt = this.db.prepare(`DELETE FROM domain_stats WHERE backend_id = ?`);
        deletedDomains = domainsStmt.run(backendId).changes;

        const ipsStmt = this.db.prepare(`DELETE FROM ip_stats WHERE backend_id = ?`);
        deletedIPs = ipsStmt.run(backendId).changes;

        const proxiesStmt = this.db.prepare(`DELETE FROM proxy_stats WHERE backend_id = ?`);
        deletedProxies = proxiesStmt.run(backendId).changes;

        const rulesStmt = this.db.prepare(`DELETE FROM rule_stats WHERE backend_id = ?`);
        deletedRules = rulesStmt.run(backendId).changes;
      } else {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const connectionsStmt = this.db.prepare(`DELETE FROM connection_logs WHERE backend_id = ? AND timestamp < ?`);
        const result = connectionsStmt.run(backendId, cutoff);
        deletedConnections = result.changes;
        deletedLogs = result.changes;
        // For partial cleanup, we keep the stats tables as they are aggregated data
      }
    } else {
      // Clean all backends
      if (days === 0) {
        // Clear all data
        const connectionsStmt = this.db.prepare(`DELETE FROM connection_logs`);
        const result = connectionsStmt.run();
        deletedConnections = result.changes;
        deletedLogs = result.changes;

        // Clear all stats tables
        const domainsStmt = this.db.prepare(`DELETE FROM domain_stats`);
        deletedDomains = domainsStmt.run().changes;

        const ipsStmt = this.db.prepare(`DELETE FROM ip_stats`);
        deletedIPs = ipsStmt.run().changes;

        const proxiesStmt = this.db.prepare(`DELETE FROM proxy_stats`);
        deletedProxies = proxiesStmt.run().changes;

        const rulesStmt = this.db.prepare(`DELETE FROM rule_stats`);
        deletedRules = rulesStmt.run().changes;
      } else {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const connectionsStmt = this.db.prepare(`DELETE FROM connection_logs WHERE timestamp < ?`);
        const result = connectionsStmt.run(cutoff);
        deletedConnections = result.changes;
        deletedLogs = result.changes;
        // For partial cleanup, we keep the stats tables as they are aggregated data
      }
    }

    // Vacuum database to reclaim space after clearing all data
    if (days === 0) {
      this.vacuum();
    }

    return { deletedConnections, deletedLogs, deletedDomains, deletedIPs, deletedProxies, deletedRules };
  }

  // Clean old ASN cache entries
  cleanupASNCache(days: number): number {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const stmt = this.db.prepare(`DELETE FROM asn_cache WHERE queried_at < ?`);
    const result = stmt.run(cutoff);
    return result.changes;
  }

  // Vacuum database to reclaim space
  vacuum(): void {
    this.db.exec('VACUUM');
  }

  // Get database file size in bytes
  getDatabaseSize(): number {
    try {
      const stats = fs.statSync(this.dbPath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  // Get connection logs count for a specific backend
  getConnectionLogsCount(backendId: number): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM connection_logs WHERE backend_id = ?
    `);
    const result = stmt.get(backendId) as { count: number };
    return result.count;
  }

  // Get total connection logs count (all backends)
  getTotalConnectionLogsCount(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM connection_logs`);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  // Backend Management Methods

  // Create a new backend configuration
  createBackend(backend: { name: string; url: string; token?: string }): number {
    const stmt = this.db.prepare(`
      INSERT INTO backend_configs (name, url, token, enabled, is_active, listening)
      VALUES (?, ?, ?, 1, 0, 1)
    `);
    const result = stmt.run(backend.name, backend.url, backend.token || '');
    return Number(result.lastInsertRowid);
  }

  // Get all backend configurations
  getAllBackends(): BackendConfig[] {
    const stmt = this.db.prepare(`
      SELECT id, name, url, token, enabled, is_active, listening, created_at, updated_at
      FROM backend_configs
      ORDER BY created_at ASC
    `);
    return stmt.all() as BackendConfig[];
  }

  // Get a backend by ID
  getBackend(id: number): BackendConfig | undefined {
    const stmt = this.db.prepare(`
      SELECT id, name, url, token, enabled, is_active, listening, created_at, updated_at
      FROM backend_configs
      WHERE id = ?
    `);
    return stmt.get(id) as BackendConfig | undefined;
  }

  // Get the currently active backend
  getActiveBackend(): BackendConfig | undefined {
    const stmt = this.db.prepare(`
      SELECT id, name, url, token, enabled, is_active, listening, created_at, updated_at
      FROM backend_configs
      WHERE is_active = 1
      LIMIT 1
    `);
    return stmt.get() as BackendConfig | undefined;
  }

  // Get all backends that should be listening (collecting data)
  getListeningBackends(): BackendConfig[] {
    const stmt = this.db.prepare(`
      SELECT id, name, url, token, enabled, is_active, listening, created_at, updated_at
      FROM backend_configs
      WHERE listening = 1 AND enabled = 1
    `);
    return stmt.all() as BackendConfig[];
  }

  // Update a backend configuration
  updateBackend(id: number, updates: Partial<Omit<BackendConfig, 'id' | 'created_at'>>): void {
    const sets: string[] = [];
    const values: (string | number | boolean)[] = [];

    if (updates.name !== undefined) {
      sets.push('name = ?');
      values.push(updates.name);
    }
    if (updates.url !== undefined) {
      sets.push('url = ?');
      values.push(updates.url);
    }
    if (updates.token !== undefined) {
      sets.push('token = ?');
      values.push(updates.token);
    }
    if (updates.enabled !== undefined) {
      sets.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.listening !== undefined) {
      sets.push('listening = ?');
      values.push(updates.listening ? 1 : 0);
    }
    if (updates.is_active !== undefined) {
      sets.push('is_active = ?');
      values.push(updates.is_active ? 1 : 0);
    }

    if (sets.length === 0) return;

    sets.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE backend_configs
      SET ${sets.join(', ')}
      WHERE id = ?
    `);
    stmt.run(...values);
  }

  // Set a backend as active (for display) - unsets all others
  setActiveBackend(id: number): void {
    this.db.exec('BEGIN TRANSACTION');
    try {
      // Unset all backends as active
      this.db.prepare(`UPDATE backend_configs SET is_active = 0`).run();
      // Set the specified backend as active
      this.db.prepare(`UPDATE backend_configs SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // Set listening state for a backend (controls data collection)
  setBackendListening(id: number, listening: boolean): void {
    const stmt = this.db.prepare(`
      UPDATE backend_configs
      SET listening = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(listening ? 1 : 0, id);
  }

  // Delete a backend and all its associated data
  deleteBackend(id: number): void {
    // Due to ON DELETE CASCADE, all associated stats will be deleted automatically
    const stmt = this.db.prepare(`DELETE FROM backend_configs WHERE id = ?`);
    stmt.run(id);
  }

  // Delete all data for a specific backend
  deleteBackendData(id: number): void {
    this.db.exec('BEGIN TRANSACTION');
    try {
      this.db.prepare(`DELETE FROM domain_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM ip_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM proxy_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM rule_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM rule_proxy_map WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM country_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM hourly_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM connection_logs WHERE backend_id = ?`).run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // Get total stats across all backends
  getGlobalSummary(): { totalConnections: number; totalUpload: number; totalDownload: number; uniqueDomains: number; uniqueIPs: number; backendCount: number } {
    const trafficStmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(connections), 0) as totalConnections,
        COALESCE(SUM(upload), 0) as upload,
        COALESCE(SUM(download), 0) as download
      FROM hourly_stats
    `);
    const { totalConnections, upload, download } = trafficStmt.get() as {
      totalConnections: number;
      upload: number;
      download: number;
    };

    const domainsStmt = this.db.prepare(`
      SELECT COUNT(DISTINCT domain) as count FROM domain_stats
    `);
    const uniqueDomains = (domainsStmt.get() as { count: number }).count;

    const ipsStmt = this.db.prepare(`
      SELECT COUNT(DISTINCT ip) as count FROM ip_stats
    `);
    const uniqueIPs = (ipsStmt.get() as { count: number }).count;

    const backendStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM backend_configs
    `);
    const backendCount = (backendStmt.get() as { count: number }).count;

    return {
      totalConnections,
      totalUpload: upload,
      totalDownload: download,
      uniqueDomains,
      uniqueIPs,
      backendCount
    };
  }

  close() {
    this.db.close();
  }
}

export default StatsDatabase;
