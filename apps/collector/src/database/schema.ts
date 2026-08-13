/**
 * Database Schema Definition
 * 
 * This file contains all CREATE TABLE statements for the SQLite database.
 * Used for initializing the database schema in a modular way.
 */

export const SCHEMA = {
  // Domain statistics - aggregated by domain per backend
  DOMAIN_STATS: `
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
  `,

  // IP statistics per backend
  IP_STATS: `
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
      chains TEXT,
      rules TEXT,
      PRIMARY KEY (backend_id, ip),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // Proxy/Chain statistics per backend
  PROXY_STATS: `
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
  `,

  // Rule statistics per backend
  RULE_STATS: `
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
  `,

  // Rule to proxy mapping per backend
  RULE_PROXY_MAP: `
    CREATE TABLE IF NOT EXISTS rule_proxy_map (
      backend_id INTEGER NOT NULL,
      rule TEXT,
      proxy TEXT,
      PRIMARY KEY (backend_id, rule, proxy),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // ASN cache
  ASN_CACHE: `
    CREATE TABLE IF NOT EXISTS asn_cache (
      ip TEXT PRIMARY KEY,
      asn TEXT,
      org TEXT,
      queried_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `,

  // GeoIP cache
  GEOIP_CACHE: `
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
  `,

  IP_DOMAIN_ENRICHMENT_CACHE: `
    CREATE TABLE IF NOT EXISTS ip_domain_enrichment_cache (
      ip TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('resolved', 'unresolved')),
      domain TEXT,
      vendor_id INTEGER,
      source TEXT CHECK (source IN ('observed', 'ptr')),
      confidence TEXT CHECK (confidence IN ('high', 'medium')),
      evidence_connections INTEGER NOT NULL DEFAULT 0,
      evidence_share REAL NOT NULL DEFAULT 0,
      forward_confirmed INTEGER NOT NULL DEFAULT 0,
      queried_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      error TEXT,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL
    );
  `,

  // Country traffic statistics per backend
  COUNTRY_STATS: `
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
  `,

  // Device statistics per backend
  DEVICE_STATS: `
    CREATE TABLE IF NOT EXISTS device_stats (
      backend_id INTEGER NOT NULL,
      source_ip TEXT NOT NULL,
      total_upload INTEGER DEFAULT 0,
      total_download INTEGER DEFAULT 0,
      total_connections INTEGER DEFAULT 0,
      last_seen DATETIME,
      PRIMARY KEY (backend_id, source_ip),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // Device×domain traffic aggregation
  DEVICE_DOMAIN_STATS: `
    CREATE TABLE IF NOT EXISTS device_domain_stats (
      backend_id INTEGER NOT NULL,
      source_ip TEXT NOT NULL,
      domain TEXT NOT NULL,
      total_upload INTEGER DEFAULT 0,
      total_download INTEGER DEFAULT 0,
      total_connections INTEGER DEFAULT 0,
      last_seen DATETIME,
      PRIMARY KEY (backend_id, source_ip, domain),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // Device×IP traffic aggregation
  DEVICE_IP_STATS: `
    CREATE TABLE IF NOT EXISTS device_ip_stats (
      backend_id INTEGER NOT NULL,
      source_ip TEXT NOT NULL,
      ip TEXT NOT NULL,
      total_upload INTEGER DEFAULT 0,
      total_download INTEGER DEFAULT 0,
      total_connections INTEGER DEFAULT 0,
      last_seen DATETIME,
      PRIMARY KEY (backend_id, source_ip, ip),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // Hourly aggregation per backend
  HOURLY_STATS: `
    CREATE TABLE IF NOT EXISTS hourly_stats (
      backend_id INTEGER NOT NULL,
      hour TEXT NOT NULL,
      upload INTEGER DEFAULT 0,
      download INTEGER DEFAULT 0,
      connections INTEGER DEFAULT 0,
      PRIMARY KEY (backend_id, hour),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // Connection log per backend
  CONNECTION_LOGS: `
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
  `,

  // Minute-level traffic aggregation
  MINUTE_STATS: `
    CREATE TABLE IF NOT EXISTS minute_stats (
      backend_id INTEGER NOT NULL,
      minute TEXT NOT NULL,
      upload INTEGER DEFAULT 0,
      download INTEGER DEFAULT 0,
      connections INTEGER DEFAULT 0,
      PRIMARY KEY (backend_id, minute),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // Minute-level fact table for accurate range queries
  MINUTE_DIM_STATS: `
    CREATE TABLE IF NOT EXISTS minute_dim_stats (
      backend_id INTEGER NOT NULL,
      minute TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      source_ip TEXT NOT NULL DEFAULT '',
      chain TEXT NOT NULL,
      rule TEXT NOT NULL,
      upload INTEGER DEFAULT 0,
      download INTEGER DEFAULT 0,
      connections INTEGER DEFAULT 0,
      PRIMARY KEY (backend_id, minute, domain, ip, source_ip, chain, rule),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // Minute-level country facts for range-based country queries
  MINUTE_COUNTRY_STATS: `
    CREATE TABLE IF NOT EXISTS minute_country_stats (
      backend_id INTEGER NOT NULL,
      minute TEXT NOT NULL,
      country TEXT NOT NULL,
      country_name TEXT,
      continent TEXT,
      upload INTEGER DEFAULT 0,
      download INTEGER DEFAULT 0,
      connections INTEGER DEFAULT 0,
      PRIMARY KEY (backend_id, minute, country),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // Hourly-level fact table for efficient long-range queries (>2h)
  HOURLY_DIM_STATS: `
    CREATE TABLE IF NOT EXISTS hourly_dim_stats (
      backend_id INTEGER NOT NULL,
      hour TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      source_ip TEXT NOT NULL DEFAULT '',
      chain TEXT NOT NULL,
      rule TEXT NOT NULL,
      upload INTEGER DEFAULT 0,
      download INTEGER DEFAULT 0,
      connections INTEGER DEFAULT 0,
      PRIMARY KEY (backend_id, hour, domain, ip, source_ip, chain, rule),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // Hourly-level country facts for efficient long-range queries
  HOURLY_COUNTRY_STATS: `
    CREATE TABLE IF NOT EXISTS hourly_country_stats (
      backend_id INTEGER NOT NULL,
      hour TEXT NOT NULL,
      country TEXT NOT NULL,
      country_name TEXT,
      continent TEXT,
      upload INTEGER DEFAULT 0,
      download INTEGER DEFAULT 0,
      connections INTEGER DEFAULT 0,
      PRIMARY KEY (backend_id, hour, country),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // Domain×proxy traffic aggregation
  DOMAIN_PROXY_STATS: `
    CREATE TABLE IF NOT EXISTS domain_proxy_stats (
      backend_id INTEGER NOT NULL,
      domain TEXT NOT NULL,
      chain TEXT NOT NULL,
      total_upload INTEGER DEFAULT 0,
      total_download INTEGER DEFAULT 0,
      total_connections INTEGER DEFAULT 0,
      last_seen DATETIME,
      PRIMARY KEY (backend_id, domain, chain),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // IP×proxy traffic aggregation
  IP_PROXY_STATS: `
    CREATE TABLE IF NOT EXISTS ip_proxy_stats (
      backend_id INTEGER NOT NULL,
      ip TEXT NOT NULL,
      chain TEXT NOT NULL,
      total_upload INTEGER DEFAULT 0,
      total_download INTEGER DEFAULT 0,
      total_connections INTEGER DEFAULT 0,
      last_seen DATETIME,
      domains TEXT,
      PRIMARY KEY (backend_id, ip, chain),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // Rule-specific cross-reference tables
  RULE_CHAIN_TRAFFIC: `
    CREATE TABLE IF NOT EXISTS rule_chain_traffic (
      backend_id INTEGER NOT NULL,
      rule TEXT NOT NULL,
      chain TEXT NOT NULL,
      total_upload INTEGER DEFAULT 0,
      total_download INTEGER DEFAULT 0,
      total_connections INTEGER DEFAULT 0,
      last_seen DATETIME,
      PRIMARY KEY (backend_id, rule, chain),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  RULE_DOMAIN_TRAFFIC: `
    CREATE TABLE IF NOT EXISTS rule_domain_traffic (
      backend_id INTEGER NOT NULL,
      rule TEXT NOT NULL,
      domain TEXT NOT NULL,
      total_upload INTEGER DEFAULT 0,
      total_download INTEGER DEFAULT 0,
      total_connections INTEGER DEFAULT 0,
      last_seen DATETIME,
      PRIMARY KEY (backend_id, rule, domain),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  RULE_IP_TRAFFIC: `
    CREATE TABLE IF NOT EXISTS rule_ip_traffic (
      backend_id INTEGER NOT NULL,
      rule TEXT NOT NULL,
      ip TEXT NOT NULL,
      total_upload INTEGER DEFAULT 0,
      total_download INTEGER DEFAULT 0,
      total_connections INTEGER DEFAULT 0,
      last_seen DATETIME,
      PRIMARY KEY (backend_id, rule, ip),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // Backend configurations
  BACKEND_CONFIGS: `
    CREATE TABLE IF NOT EXISTS backend_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      token TEXT DEFAULT '',
      type TEXT DEFAULT 'clash',
      enabled BOOLEAN DEFAULT 1,
      is_active BOOLEAN DEFAULT 0,
      listening BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `,

  // Agent heartbeat status per backend (for agent:// passive mode)
  AGENT_HEARTBEATS: `
    CREATE TABLE IF NOT EXISTS agent_heartbeats (
      backend_id INTEGER PRIMARY KEY,
      agent_id TEXT NOT NULL,
      hostname TEXT,
      version TEXT,
      gateway_type TEXT,
      gateway_url TEXT,
      remote_ip TEXT,
      gateway_latency_ms INTEGER,
      server_latency_ms INTEGER,
      last_seen DATETIME NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // App configuration
  APP_CONFIG: `
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `,

  // Surge policy cache
  SURGE_POLICY_CACHE: `
    CREATE TABLE IF NOT EXISTS surge_policy_cache (
      backend_id INTEGER NOT NULL,
      policy_group TEXT NOT NULL,
      selected_policy TEXT,
      policy_type TEXT DEFAULT 'Select',
      all_policies TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (backend_id, policy_group),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // Auth configuration
  AUTH_CONFIG: `
    CREATE TABLE IF NOT EXISTS auth_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `,

  // Agent config snapshot - persists agent configuration across restarts
  AGENT_SNAPSHOTS: `
    CREATE TABLE IF NOT EXISTS agent_snapshots (
      backend_id INTEGER PRIMARY KEY,
      config_json TEXT NOT NULL,
      policy_state_json TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // Backend health check log - one row per minute per backend
  BACKEND_HEALTH_LOGS: `
    CREATE TABLE IF NOT EXISTS backend_health_logs (
      backend_id INTEGER NOT NULL,
      minute TEXT NOT NULL,
      status TEXT NOT NULL,
      latency_ms INTEGER,
      server_latency_ms INTEGER,
      message TEXT,
      PRIMARY KEY (backend_id, minute),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  // Traffic vendor dictionary and domain suffix rules.
  VENDORS: `
    CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#64748b',
      priority INTEGER NOT NULL DEFAULT 0,
      enabled BOOLEAN NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `,

  VENDOR_DOMAIN_RULES: `
    CREATE TABLE IF NOT EXISTS vendor_domain_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id INTEGER NOT NULL,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL DEFAULT 'suffix' CHECK (match_type IN ('exact', 'suffix')),
      priority INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'catalog', 'builtin')),
      source_key TEXT,
      source_revision TEXT,
      confidence TEXT NOT NULL DEFAULT 'high' CHECK (confidence IN ('high', 'medium', 'low')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(vendor_id, pattern, match_type),
      FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
    );
  `,

  // Low-cardinality vendor rollups. Hourly data is retained for 365 days;
  // daily data is the compact long-term history.
  VENDOR_HOURLY_STATS: `
    CREATE TABLE IF NOT EXISTS vendor_hourly_stats (
      backend_id INTEGER NOT NULL,
      hour TEXT NOT NULL,
      source_ip TEXT NOT NULL DEFAULT '',
      vendor_id INTEGER NOT NULL,
      upload INTEGER NOT NULL DEFAULT 0,
      download INTEGER NOT NULL DEFAULT 0,
      connections INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (backend_id, hour, source_ip, vendor_id),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
    );
  `,

  VENDOR_DAILY_STATS: `
    CREATE TABLE IF NOT EXISTS vendor_daily_stats (
      backend_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      source_ip TEXT NOT NULL DEFAULT '',
      vendor_id INTEGER NOT NULL,
      upload INTEGER NOT NULL DEFAULT 0,
      download INTEGER NOT NULL DEFAULT 0,
      connections INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (backend_id, day, source_ip, vendor_id),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
    );
  `,

  // Protocol rollups deliberately keep only low-cardinality dimensions.
  VENDOR_PROTOCOL_HOURLY_STATS: `
    CREATE TABLE IF NOT EXISTS vendor_protocol_hourly_stats (
      backend_id INTEGER NOT NULL,
      hour TEXT NOT NULL,
      source_ip TEXT NOT NULL DEFAULT '',
      vendor_id INTEGER NOT NULL,
      transport TEXT NOT NULL CHECK (transport IN ('tcp', 'udp', 'unknown')),
      application_protocol TEXT NOT NULL CHECK (application_protocol IN ('http', 'tls', 'quic', 'dns', 'other')),
      confidence TEXT NOT NULL CHECK (confidence IN ('exact', 'inferred', 'unknown')),
      upload INTEGER NOT NULL DEFAULT 0,
      download INTEGER NOT NULL DEFAULT 0,
      connections INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (backend_id, hour, source_ip, vendor_id, transport, application_protocol, confidence),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
    );
  `,

  VENDOR_PROTOCOL_DAILY_STATS: `
    CREATE TABLE IF NOT EXISTS vendor_protocol_daily_stats (
      backend_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      source_ip TEXT NOT NULL DEFAULT '',
      vendor_id INTEGER NOT NULL,
      transport TEXT NOT NULL CHECK (transport IN ('tcp', 'udp', 'unknown')),
      application_protocol TEXT NOT NULL CHECK (application_protocol IN ('http', 'tls', 'quic', 'dns', 'other')),
      confidence TEXT NOT NULL CHECK (confidence IN ('exact', 'inferred', 'unknown')),
      upload INTEGER NOT NULL DEFAULT 0,
      download INTEGER NOT NULL DEFAULT 0,
      connections INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (backend_id, day, source_ip, vendor_id, transport, application_protocol, confidence),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
    );
  `,

  // Canonical endpoint rollups: a connection is counted as a domain when a
  // domain was observed, otherwise as an IP. Keeping protocol on the same row
  // lets the UI explain Top endpoints without joining expired detail tables.
  VENDOR_ENDPOINT_HOURLY_STATS: `
    CREATE TABLE IF NOT EXISTS vendor_endpoint_hourly_stats (
      backend_id INTEGER NOT NULL,
      hour TEXT NOT NULL,
      source_ip TEXT NOT NULL DEFAULT '',
      vendor_id INTEGER NOT NULL,
      endpoint_type TEXT NOT NULL CHECK (endpoint_type IN ('domain', 'ip')),
      endpoint TEXT NOT NULL,
      transport TEXT NOT NULL CHECK (transport IN ('tcp', 'udp', 'unknown')),
      application_protocol TEXT NOT NULL CHECK (application_protocol IN ('http', 'tls', 'quic', 'dns', 'other')),
      confidence TEXT NOT NULL CHECK (confidence IN ('exact', 'inferred', 'unknown')),
      upload INTEGER NOT NULL DEFAULT 0,
      download INTEGER NOT NULL DEFAULT 0,
      connections INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (
        backend_id, hour, source_ip, vendor_id, endpoint_type, endpoint,
        transport, application_protocol, confidence
      ),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
    );
  `,

  VENDOR_ENDPOINT_DAILY_STATS: `
    CREATE TABLE IF NOT EXISTS vendor_endpoint_daily_stats (
      backend_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      source_ip TEXT NOT NULL DEFAULT '',
      vendor_id INTEGER NOT NULL,
      endpoint_type TEXT NOT NULL CHECK (endpoint_type IN ('domain', 'ip')),
      endpoint TEXT NOT NULL,
      transport TEXT NOT NULL CHECK (transport IN ('tcp', 'udp', 'unknown')),
      application_protocol TEXT NOT NULL CHECK (application_protocol IN ('http', 'tls', 'quic', 'dns', 'other')),
      confidence TEXT NOT NULL CHECK (confidence IN ('exact', 'inferred', 'unknown')),
      upload INTEGER NOT NULL DEFAULT 0,
      download INTEGER NOT NULL DEFAULT 0,
      connections INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (
        backend_id, day, source_ip, vendor_id, endpoint_type, endpoint,
        transport, application_protocol, confidence
      ),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
    );
  `,

  TRAFFIC_OBSERVABILITY_HOURLY_STATS: `
    CREATE TABLE IF NOT EXISTS traffic_observability_hourly_stats (
      backend_id INTEGER NOT NULL,
      hour TEXT NOT NULL,
      source_ip TEXT NOT NULL DEFAULT '',
      domain_present INTEGER NOT NULL CHECK (domain_present IN (0, 1)),
      upload INTEGER NOT NULL DEFAULT 0,
      download INTEGER NOT NULL DEFAULT 0,
      connections INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (backend_id, hour, source_ip, domain_present),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  TRAFFIC_OBSERVABILITY_DAILY_STATS: `
    CREATE TABLE IF NOT EXISTS traffic_observability_daily_stats (
      backend_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      source_ip TEXT NOT NULL DEFAULT '',
      domain_present INTEGER NOT NULL CHECK (domain_present IN (0, 1)),
      upload INTEGER NOT NULL DEFAULT 0,
      download INTEGER NOT NULL DEFAULT 0,
      connections INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (backend_id, day, source_ip, domain_present),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  UNRESOLVED_DOMAIN_DAILY_STATS: `
    CREATE TABLE IF NOT EXISTS unresolved_domain_daily_stats (
      backend_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      source_ip TEXT NOT NULL DEFAULT '',
      registrable_domain TEXT NOT NULL,
      upload INTEGER NOT NULL DEFAULT 0,
      download INTEGER NOT NULL DEFAULT 0,
      connections INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (backend_id, day, source_ip, registrable_domain),
      FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
    );
  `,

  VENDOR_CATALOG_STATE: `
    CREATE TABLE IF NOT EXISTS vendor_catalog_state (
      source_key TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      revision TEXT,
      etag TEXT,
      status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'syncing', 'success', 'failed')),
      rules_count INTEGER NOT NULL DEFAULT 0,
      conflict_count INTEGER NOT NULL DEFAULT 0,
      excluded_count INTEGER NOT NULL DEFAULT 0,
      last_checked_at DATETIME,
      last_success_at DATETIME,
      error TEXT
    );
  `,

  // Slim Uptime-style availability monitoring.
  MONITORS: `
    CREATE TABLE IF NOT EXISTS monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK (type IN ('icmp', 'tcp', 'http', 'dns')),
      target TEXT NOT NULL,
      port INTEGER,
      http_method TEXT NOT NULL DEFAULT 'GET',
      expected_status_min INTEGER NOT NULL DEFAULT 200,
      expected_status_max INTEGER NOT NULL DEFAULT 399,
      dns_server TEXT,
      dns_record_type TEXT NOT NULL DEFAULT 'A',
      dns_expected TEXT,
      interval_seconds INTEGER NOT NULL DEFAULT 60,
      timeout_ms INTEGER NOT NULL DEFAULT 5000,
      failure_threshold INTEGER NOT NULL DEFAULT 3,
      recovery_threshold INTEGER NOT NULL DEFAULT 1,
      latency_warning_ms INTEGER,
      enabled BOOLEAN NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `,

  MONITOR_STATES: `
    CREATE TABLE IF NOT EXISTS monitor_states (
      monitor_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'up', 'down', 'degraded', 'paused')),
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      consecutive_successes INTEGER NOT NULL DEFAULT 0,
      last_checked_at DATETIME,
      last_up_at DATETIME,
      last_down_at DATETIME,
      latency_ms INTEGER,
      message TEXT,
      FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
    );
  `,

  MONITOR_MINUTE_STATS: `
    CREATE TABLE IF NOT EXISTS monitor_minute_stats (
      monitor_id INTEGER NOT NULL,
      minute TEXT NOT NULL,
      checks INTEGER NOT NULL DEFAULT 0,
      up_checks INTEGER NOT NULL DEFAULT 0,
      down_checks INTEGER NOT NULL DEFAULT 0,
      degraded_checks INTEGER NOT NULL DEFAULT 0,
      latency_sum INTEGER NOT NULL DEFAULT 0,
      latency_min INTEGER,
      latency_max INTEGER,
      last_status TEXT NOT NULL,
      PRIMARY KEY (monitor_id, minute),
      FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
    );
  `,

  MONITOR_HOURLY_STATS: `
    CREATE TABLE IF NOT EXISTS monitor_hourly_stats (
      monitor_id INTEGER NOT NULL,
      hour TEXT NOT NULL,
      checks INTEGER NOT NULL DEFAULT 0,
      up_checks INTEGER NOT NULL DEFAULT 0,
      down_checks INTEGER NOT NULL DEFAULT 0,
      degraded_checks INTEGER NOT NULL DEFAULT 0,
      latency_sum INTEGER NOT NULL DEFAULT 0,
      latency_min INTEGER,
      latency_max INTEGER,
      last_status TEXT NOT NULL,
      PRIMARY KEY (monitor_id, hour),
      FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
    );
  `,

  MONITOR_INCIDENTS: `
    CREATE TABLE IF NOT EXISTS monitor_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER NOT NULL,
      started_at DATETIME NOT NULL,
      ended_at DATETIME,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      cause TEXT,
      message TEXT,
      FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
    );
  `,
} as const;

// Index definitions
export const INDEXES = [
  // Device stats indexes
  `CREATE INDEX IF NOT EXISTS idx_device_domain_source_ip ON device_domain_stats(backend_id, source_ip);`,
  `CREATE INDEX IF NOT EXISTS idx_device_ip_source_ip ON device_ip_stats(backend_id, source_ip);`,

  // Domain proxy stats index
  `CREATE INDEX IF NOT EXISTS idx_domain_proxy_chain ON domain_proxy_stats(backend_id, chain);`,

  // IP proxy stats index
  `CREATE INDEX IF NOT EXISTS idx_ip_proxy_chain ON ip_proxy_stats(backend_id, chain);`,

  // Rule traffic indexes
  `CREATE INDEX IF NOT EXISTS idx_rule_chain_traffic ON rule_chain_traffic(backend_id, rule);`,
  `CREATE INDEX IF NOT EXISTS idx_rule_domain_traffic ON rule_domain_traffic(backend_id, rule);`,
  `CREATE INDEX IF NOT EXISTS idx_rule_ip_traffic ON rule_ip_traffic(backend_id, rule);`,

  // Stats indexes.
  // No expression indexes on (total_download + total_upload): every hot query
  // filters by backend_id first, so SQLite never used them for the ORDER BY —
  // they only added write amplification on the four hottest tables.
  `CREATE INDEX IF NOT EXISTS idx_domain_stats_backend ON domain_stats(backend_id);`,
  `CREATE INDEX IF NOT EXISTS idx_ip_stats_backend ON ip_stats(backend_id);`,
  `CREATE INDEX IF NOT EXISTS idx_proxy_stats_backend ON proxy_stats(backend_id);`,
  `CREATE INDEX IF NOT EXISTS idx_rule_stats_backend ON rule_stats(backend_id);`,
  `CREATE INDEX IF NOT EXISTS idx_rule_proxy_map ON rule_proxy_map(backend_id, rule, proxy);`,
  `CREATE INDEX IF NOT EXISTS idx_country_stats_backend ON country_stats(backend_id);`,
  `CREATE INDEX IF NOT EXISTS idx_hourly_stats_backend ON hourly_stats(backend_id);`,

  // Minute stats indexes
  `CREATE INDEX IF NOT EXISTS idx_minute_stats_backend_minute ON minute_stats(backend_id, minute);`,
  `CREATE INDEX IF NOT EXISTS idx_minute_dim_backend_minute ON minute_dim_stats(backend_id, minute);`,
  `CREATE INDEX IF NOT EXISTS idx_minute_dim_backend_minute_domain ON minute_dim_stats(backend_id, minute, domain);`,
  `CREATE INDEX IF NOT EXISTS idx_minute_dim_backend_minute_ip ON minute_dim_stats(backend_id, minute, ip);`,
  `CREATE INDEX IF NOT EXISTS idx_minute_dim_backend_minute_chain ON minute_dim_stats(backend_id, minute, chain);`,
  `CREATE INDEX IF NOT EXISTS idx_minute_dim_backend_minute_rule ON minute_dim_stats(backend_id, minute, rule);`,
  `CREATE INDEX IF NOT EXISTS idx_minute_dim_backend_minute_source ON minute_dim_stats(backend_id, minute, source_ip);`,
  `CREATE INDEX IF NOT EXISTS idx_minute_country_backend_minute ON minute_country_stats(backend_id, minute);`,

  // Hourly dim stats indexes
  `CREATE INDEX IF NOT EXISTS idx_hourly_dim_backend_hour ON hourly_dim_stats(backend_id, hour);`,
  `CREATE INDEX IF NOT EXISTS idx_hourly_dim_backend_hour_domain ON hourly_dim_stats(backend_id, hour, domain);`,
  `CREATE INDEX IF NOT EXISTS idx_hourly_dim_backend_hour_ip ON hourly_dim_stats(backend_id, hour, ip);`,
  `CREATE INDEX IF NOT EXISTS idx_hourly_dim_backend_hour_chain ON hourly_dim_stats(backend_id, hour, chain);`,
  `CREATE INDEX IF NOT EXISTS idx_hourly_dim_backend_hour_rule ON hourly_dim_stats(backend_id, hour, rule);`,
  `CREATE INDEX IF NOT EXISTS idx_hourly_dim_backend_hour_source ON hourly_dim_stats(backend_id, hour, source_ip);`,
  `CREATE INDEX IF NOT EXISTS idx_hourly_country_backend_hour ON hourly_country_stats(backend_id, hour);`,

  // Connection logs indexes
  `CREATE INDEX IF NOT EXISTS idx_connection_logs_backend ON connection_logs(backend_id);`,
  `CREATE INDEX IF NOT EXISTS idx_connection_logs_timestamp ON connection_logs(timestamp);`,
  `CREATE INDEX IF NOT EXISTS idx_connection_logs_domain ON connection_logs(domain);`,
  `CREATE INDEX IF NOT EXISTS idx_connection_logs_chain ON connection_logs(chain);`,

  // Backend configs unique index
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_backend_configs_name ON backend_configs(name);`,

  // Agent heartbeat indexes
  `CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_last_seen ON agent_heartbeats(last_seen);`,

  // Backend health log indexes
  `CREATE INDEX IF NOT EXISTS idx_backend_health_logs_backend_minute ON backend_health_logs(backend_id, minute);`,
  `CREATE INDEX IF NOT EXISTS idx_backend_health_logs_minute ON backend_health_logs(minute);`,

  // Vendor rollup indexes
  `CREATE INDEX IF NOT EXISTS idx_vendor_rules_pattern ON vendor_domain_rules(pattern, match_type);`,
  `CREATE INDEX IF NOT EXISTS idx_vendor_hourly_backend_hour ON vendor_hourly_stats(backend_id, hour);`,
  `CREATE INDEX IF NOT EXISTS idx_vendor_hourly_backend_vendor_hour ON vendor_hourly_stats(backend_id, vendor_id, hour);`,
  `CREATE INDEX IF NOT EXISTS idx_vendor_daily_backend_day ON vendor_daily_stats(backend_id, day);`,
  `CREATE INDEX IF NOT EXISTS idx_vendor_protocol_hourly_backend_hour ON vendor_protocol_hourly_stats(backend_id, hour);`,
  `CREATE INDEX IF NOT EXISTS idx_vendor_protocol_daily_backend_day ON vendor_protocol_daily_stats(backend_id, day);`,
  `CREATE INDEX IF NOT EXISTS idx_vendor_endpoint_hourly_lookup ON vendor_endpoint_hourly_stats(backend_id, vendor_id, hour, source_ip);`,
  `CREATE INDEX IF NOT EXISTS idx_vendor_endpoint_daily_lookup ON vendor_endpoint_daily_stats(backend_id, vendor_id, day, source_ip);`,
  `CREATE INDEX IF NOT EXISTS idx_observability_hourly_backend_hour ON traffic_observability_hourly_stats(backend_id, hour);`,
  `CREATE INDEX IF NOT EXISTS idx_observability_daily_backend_day ON traffic_observability_daily_stats(backend_id, day);`,
  `CREATE INDEX IF NOT EXISTS idx_unresolved_domain_backend_day ON unresolved_domain_daily_stats(backend_id, day);`,

  // Availability monitoring indexes
  `CREATE INDEX IF NOT EXISTS idx_monitors_enabled ON monitors(enabled);`,
  `CREATE INDEX IF NOT EXISTS idx_monitor_states_last_checked ON monitor_states(last_checked_at);`,
  `CREATE INDEX IF NOT EXISTS idx_monitor_minute_time ON monitor_minute_stats(minute);`,
  `CREATE INDEX IF NOT EXISTS idx_monitor_hourly_time ON monitor_hourly_stats(hour);`,
  `CREATE INDEX IF NOT EXISTS idx_monitor_incidents_monitor_started ON monitor_incidents(monitor_id, started_at);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_monitor_incidents_open ON monitor_incidents(monitor_id) WHERE status = 'open';`,

  // Surge policy cache indexes
  `CREATE INDEX IF NOT EXISTS idx_surge_policy_backend ON surge_policy_cache(backend_id);`,
  `CREATE INDEX IF NOT EXISTS idx_surge_policy_updated ON surge_policy_cache(updated_at);`,
] as const;

// Default app config values
export const DEFAULT_APP_CONFIG = `
  INSERT OR IGNORE INTO app_config (key, value) VALUES 
    ('retention.connection_logs_days', '7'),
    ('retention.hourly_stats_days', '30'),
    ('retention.vendor_hourly_days', '365'),
    ('retention.vendor_endpoint_hourly_days', '90'),
    ('vendor.catalog_auto_update', '1'),
    ('vendor.catalog_interval_hours', '24'),
    ('vendor.catalog_backfill_days', '30'),
    ('retention.monitor_minute_days', '30'),
    ('retention.monitor_hourly_days', '365'),
    ('retention.auto_cleanup', '1'),
    ('monitor.webhook_enabled', '0'),
    ('monitor.webhook_url', ''),
    ('geoip.lookup_provider', 'online'),
    ('geoip.online_api_url', 'https://api.ipinfo.es/ipinfo');
`;

export const DEFAULT_VENDOR_DATA = `
  INSERT OR IGNORE INTO vendors (slug, name, color, priority) VALUES
    ('unknown', 'Unknown', '#64748b', -1000),
    ('apple', 'Apple', '#6b7280', 100),
    ('google', 'Google / YouTube', '#4285f4', 100),
    ('microsoft', 'Microsoft', '#00a4ef', 100),
    ('tencent', 'Tencent', '#12b7f5', 100),
    ('alibaba', 'Alibaba', '#ff6a00', 100),
    ('bytedance', 'ByteDance', '#111827', 100),
    ('amazon', 'Amazon / AWS', '#ff9900', 100),
    ('meta', 'Meta', '#0668e1', 100),
    ('openai', 'OpenAI', '#10a37f', 100),
    ('cloudflare', 'Cloudflare', '#f48120', 100),
    ('xiaomi', 'Xiaomi', '#ff6900', 100),
    ('bilibili', 'Bilibili', '#00aeec', 100),
    ('netflix', 'Netflix', '#e50914', 100);

  INSERT OR IGNORE INTO vendors (slug, name, color, priority) VALUES
    ('qnap', 'QNAP', '#0067b1', 100),
    ('wangsu', 'Wangsu CDN', '#ef4444', 20),
    ('midea', 'Midea', '#2563eb', 100),
    ('netease', 'NetEase', '#d9272e', 100),
    ('akamai', 'Akamai CDN', '#f97316', 20),
    ('fastly', 'Fastly CDN', '#dc2626', 20),
    ('kingsoft', 'Kingsoft / Kingsoft Cloud', '#2563eb', 20),
    ('baishancloud', 'BaishanCloud CDN', '#0891b2', 20),
    ('tonghuashun', '同花顺', '#ef4444', 100),
    ('happy-elements', '乐元素', '#ec4899', 100),
    ('broadlink', 'BroadLink', '#0ea5e9', 100),
    ('zte', 'ZTE', '#1d4ed8', 100),
    ('boss-zhipin', 'BOSS直聘', '#14b8a6', 100),
    ('self-hosted-office', '自建 / 办公服务', '#64748b', 80),
    ('baidu', 'Baidu', '#2563eb', 100),
    ('shanghai-online', '上海热线 / 测速', '#0f766e', 100),
    ('taiwan-mobile', 'Taiwan Mobile', '#f97316', 100),
    ('pptv', 'PPTV', '#16a34a', 100),
    ('ipinfo-es', 'IPInfo.es', '#7c3aed', 100),
    ('metacubex', 'Mihomo / MetaCubeX', '#334155', 100),
    ('sigmob', 'Sigmob', '#db2777', 100);

  INSERT OR IGNORE INTO vendor_domain_rules
    (vendor_id, pattern, match_type, priority, source, source_key, source_revision, confidence)
  SELECT v.id, r.pattern, 'suffix', 100,
         'builtin', 'core-defaults', '2026-08-13.3', 'high'
  FROM vendors v
  JOIN (
    SELECT 'apple' slug, 'apple.com' pattern UNION ALL SELECT 'apple', 'icloud.com' UNION ALL SELECT 'apple', 'mzstatic.com' UNION ALL SELECT 'apple', 'apple-dns.net' UNION ALL
    SELECT 'google', 'google.com' UNION ALL SELECT 'google', 'googleapis.com' UNION ALL SELECT 'google', 'gstatic.com' UNION ALL SELECT 'google', 'googlevideo.com' UNION ALL SELECT 'google', 'youtube.com' UNION ALL SELECT 'google', 'ytimg.com' UNION ALL SELECT 'google', 'googleusercontent.com' UNION ALL SELECT 'google', 'doubleclick.net' UNION ALL SELECT 'google', 'android.com' UNION ALL
    SELECT 'microsoft', 'microsoft.com' UNION ALL SELECT 'microsoft', 'windows.com' UNION ALL SELECT 'microsoft', 'windowsupdate.com' UNION ALL SELECT 'microsoft', 'microsoftonline.com' UNION ALL SELECT 'microsoft', 'office.com' UNION ALL SELECT 'microsoft', 'live.com' UNION ALL SELECT 'microsoft', 'xboxlive.com' UNION ALL SELECT 'microsoft', 'azureedge.net' UNION ALL
    SELECT 'tencent', 'qq.com' UNION ALL SELECT 'tencent', 'qpic.cn' UNION ALL SELECT 'tencent', 'qcloud.com' UNION ALL SELECT 'tencent', 'weixin.qq.com' UNION ALL SELECT 'tencent', 'wechat.com' UNION ALL SELECT 'tencent', 'gtimg.com' UNION ALL SELECT 'tencent', 'myqcloud.com' UNION ALL
    SELECT 'alibaba', 'alibaba.com' UNION ALL SELECT 'alibaba', 'alicdn.com' UNION ALL SELECT 'alibaba', 'aliyun.com' UNION ALL SELECT 'alibaba', 'aliyuncs.com' UNION ALL SELECT 'alibaba', 'alipay.com' UNION ALL SELECT 'alibaba', 'taobao.com' UNION ALL SELECT 'alibaba', 'tmall.com' UNION ALL SELECT 'alibaba', 'mmstat.com' UNION ALL
    SELECT 'bytedance', 'bytedance.com' UNION ALL SELECT 'bytedance', 'byteimg.com' UNION ALL SELECT 'bytedance', 'snssdk.com' UNION ALL SELECT 'bytedance', 'douyin.com' UNION ALL SELECT 'bytedance', 'toutiao.com' UNION ALL SELECT 'bytedance', 'ixigua.com' UNION ALL
    SELECT 'amazon', 'amazon.com' UNION ALL SELECT 'amazon', 'amazonaws.com' UNION ALL SELECT 'amazon', 'cloudfront.net' UNION ALL SELECT 'amazon', 'twitch.tv' UNION ALL
    SELECT 'meta', 'facebook.com' UNION ALL SELECT 'meta', 'fbcdn.net' UNION ALL SELECT 'meta', 'instagram.com' UNION ALL SELECT 'meta', 'whatsapp.net' UNION ALL
    SELECT 'openai', 'openai.com' UNION ALL SELECT 'openai', 'chatgpt.com' UNION ALL SELECT 'openai', 'oaistatic.com' UNION ALL SELECT 'openai', 'oaiusercontent.com' UNION ALL
    SELECT 'cloudflare', 'cloudflare.com' UNION ALL SELECT 'cloudflare', 'cloudflare-dns.com' UNION ALL
    SELECT 'xiaomi', 'mi.com' UNION ALL SELECT 'xiaomi', 'xiaomi.com' UNION ALL SELECT 'xiaomi', 'miui.com' UNION ALL
    SELECT 'bilibili', 'bilibili.com' UNION ALL SELECT 'bilibili', 'bilivideo.com' UNION ALL
    SELECT 'netflix', 'netflix.com' UNION ALL SELECT 'netflix', 'nflxvideo.net' UNION ALL SELECT 'netflix', 'nflximg.net'
  ) r ON r.slug = v.slug;

  -- Before manual rule editing existed, core defaults used the column's
  -- historical default source ('manual'). Migrate that one-time legacy shape
  -- so newly added manual overrides can reliably outrank the defaults.
  UPDATE vendor_domain_rules
  SET source = 'builtin', source_key = 'core-defaults',
      source_revision = '2026-08-13.3', confidence = 'high'
  WHERE source = 'manual' AND source_key IS NULL AND priority = 100
    AND NOT EXISTS (
      SELECT 1 FROM app_config
      WHERE key = 'vendor.core_defaults_source_migrated'
    );

  INSERT OR IGNORE INTO app_config (key, value)
  VALUES ('vendor.core_defaults_source_migrated', '2026-08-13.3');

  -- High-confidence additions observed on the home network. Business aliases
  -- wrapped by a CDN use a higher priority than the infrastructure fallback.
  INSERT OR IGNORE INTO vendor_domain_rules
    (vendor_id, pattern, match_type, priority, source, source_key, source_revision, confidence)
  SELECT v.id, r.pattern, r.match_type, r.priority,
         'builtin', 'home-high-confidence', '2026-08-13.3', r.confidence
  FROM vendors v
  JOIN (
    SELECT 'bytedance' slug, 'rtcxyz.com' pattern, 'suffix' match_type, 400 priority, 'high' confidence UNION ALL
    SELECT 'bytedance', 'pglstatp-toutiao.com.bsgslb.com', 'suffix', 350, 'high' UNION ALL
    SELECT 'bytedance', 'pglstatp-toutiao.com.download.ks-cdn.com', 'suffix', 350, 'high' UNION ALL
    SELECT 'bytedance', 'bytedance.map.fastly.net', 'suffix', 350, 'high' UNION ALL
    SELECT 'apple', 'push-apple.com.akadns.net', 'suffix', 350, 'high' UNION ALL

    SELECT 'akamai', 'akamai.net', 'suffix', 100, 'high' UNION ALL
    SELECT 'akamai', 'akadns.net', 'suffix', 100, 'high' UNION ALL
    SELECT 'akamai', 'akamaiedge.net', 'suffix', 100, 'high' UNION ALL
    SELECT 'akamai', 'akamaihd.net', 'suffix', 100, 'high' UNION ALL
    SELECT 'fastly', 'fastly.net', 'suffix', 100, 'high' UNION ALL
    SELECT 'fastly', 'fastlylb.net', 'suffix', 100, 'high' UNION ALL
    SELECT 'kingsoft', 'ks-cdn.com', 'suffix', 100, 'high' UNION ALL
    SELECT 'kingsoft', 'ksyuncdn.com', 'suffix', 100, 'high' UNION ALL
    SELECT 'kingsoft', 'ksyungslb.com', 'suffix', 100, 'high' UNION ALL
    SELECT 'baishancloud', 'bsgslb.com', 'suffix', 100, 'high' UNION ALL

    SELECT 'tonghuashun', 'thsi.cn', 'suffix', 200, 'high' UNION ALL
    SELECT 'tonghuashun', '123ths.com', 'suffix', 200, 'high' UNION ALL
    SELECT 'tonghuashun', '10jqka.com.cn', 'suffix', 200, 'high' UNION ALL
    SELECT 'tonghuashun', 'hexin.cn', 'suffix', 200, 'high' UNION ALL
    SELECT 'happy-elements', 'happyelements.cn', 'suffix', 200, 'high' UNION ALL
    SELECT 'broadlink', 'broadlink.com.cn', 'suffix', 200, 'high' UNION ALL
    SELECT 'broadlink', 'broadlink.com', 'suffix', 200, 'high' UNION ALL
    SELECT 'zte', 'ztehome.com.cn', 'suffix', 200, 'high' UNION ALL
    SELECT 'zte', 'zte.com.cn', 'suffix', 200, 'high' UNION ALL
    SELECT 'boss-zhipin', 'zhipin.com', 'suffix', 200, 'high' UNION ALL
    SELECT 'boss-zhipin', 'bosszhipin.com', 'suffix', 200, 'high' UNION ALL

    SELECT 'google', 'dns.google', 'suffix', 200, 'high' UNION ALL
    SELECT 'kingsoft', 'ksyunv5.com', 'suffix', 200, 'high' UNION ALL
    SELECT 'baidu', 'baidu.com', 'suffix', 200, 'high' UNION ALL
    SELECT 'baidu', 'shifen.com', 'suffix', 200, 'high' UNION ALL
    SELECT 'shanghai-online', 'online.sh.cn', 'suffix', 300, 'high' UNION ALL
    SELECT 'taiwan-mobile', 'taiwanmobile.com', 'suffix', 200, 'high' UNION ALL
    SELECT 'pptv', 'pptv.com', 'suffix', 200, 'high' UNION ALL
    SELECT 'ipinfo-es', 'ipinfo.es', 'suffix', 200, 'high' UNION ALL
    SELECT 'metacubex', 'metacubex.one', 'suffix', 200, 'high' UNION ALL
    SELECT 'sigmob', 'sigmob.cn', 'suffix', 200, 'high' UNION ALL

    SELECT 'self-hosted-office', 'vpn1.office1006.xlhb.com', 'exact', 400, 'high'
  ) r ON r.slug = v.slug;

  UPDATE vendor_domain_rules
  SET source_revision = '2026-08-13.3'
  WHERE source = 'builtin' AND source_key = 'home-high-confidence';
`;

// Default auth config values
export const DEFAULT_AUTH_CONFIG = `
  INSERT OR IGNORE INTO auth_config (key, value) VALUES 
    ('enabled', '0'),
    ('token_hash', '');
`;

// Get all schema creation statements in order
export function getAllSchemaStatements(): string[] {
  return [
    SCHEMA.DOMAIN_STATS,
    SCHEMA.IP_STATS,
    SCHEMA.PROXY_STATS,
    SCHEMA.RULE_STATS,
    SCHEMA.RULE_PROXY_MAP,
    SCHEMA.ASN_CACHE,
    SCHEMA.GEOIP_CACHE,
    SCHEMA.COUNTRY_STATS,
    SCHEMA.DEVICE_STATS,
    SCHEMA.DEVICE_DOMAIN_STATS,
    SCHEMA.DEVICE_IP_STATS,
    SCHEMA.HOURLY_STATS,
    SCHEMA.CONNECTION_LOGS,
    SCHEMA.MINUTE_STATS,
    SCHEMA.MINUTE_DIM_STATS,
    SCHEMA.MINUTE_COUNTRY_STATS,
    SCHEMA.HOURLY_DIM_STATS,
    SCHEMA.HOURLY_COUNTRY_STATS,
    SCHEMA.DOMAIN_PROXY_STATS,
    SCHEMA.IP_PROXY_STATS,
    SCHEMA.RULE_CHAIN_TRAFFIC,
    SCHEMA.RULE_DOMAIN_TRAFFIC,
    SCHEMA.RULE_IP_TRAFFIC,
    SCHEMA.BACKEND_CONFIGS,
    SCHEMA.AGENT_HEARTBEATS,
    SCHEMA.AGENT_SNAPSHOTS,
    SCHEMA.BACKEND_HEALTH_LOGS,
    SCHEMA.VENDORS,
    SCHEMA.VENDOR_DOMAIN_RULES,
    SCHEMA.IP_DOMAIN_ENRICHMENT_CACHE,
    SCHEMA.VENDOR_HOURLY_STATS,
    SCHEMA.VENDOR_DAILY_STATS,
    SCHEMA.VENDOR_PROTOCOL_HOURLY_STATS,
    SCHEMA.VENDOR_PROTOCOL_DAILY_STATS,
    SCHEMA.VENDOR_ENDPOINT_HOURLY_STATS,
    SCHEMA.VENDOR_ENDPOINT_DAILY_STATS,
    SCHEMA.TRAFFIC_OBSERVABILITY_HOURLY_STATS,
    SCHEMA.TRAFFIC_OBSERVABILITY_DAILY_STATS,
    SCHEMA.UNRESOLVED_DOMAIN_DAILY_STATS,
    SCHEMA.VENDOR_CATALOG_STATE,
    SCHEMA.MONITORS,
    SCHEMA.MONITOR_STATES,
    SCHEMA.MONITOR_MINUTE_STATS,
    SCHEMA.MONITOR_HOURLY_STATS,
    SCHEMA.MONITOR_INCIDENTS,
    SCHEMA.APP_CONFIG,
    SCHEMA.SURGE_POLICY_CACHE,
    SCHEMA.AUTH_CONFIG,
    ...INDEXES,
    DEFAULT_APP_CONFIG,
    DEFAULT_VENDOR_DATA,
    DEFAULT_AUTH_CONFIG,
  ];
}
