import type { GeoIPInfo } from "./geo-ip-utils.js";

// Gateway Connection Metadata
export interface ConnectionMetadata {
  network: string;
  type: string;
  sourceIP: string;
  destinationIP: string;
  sourceGeoIP: string[] | null;
  destinationGeoIP: string[] | null;
  sourceIPASN: string;
  destinationIPASN: string;
  sourcePort: string;
  destinationPort: string;
  inboundIP: string;
  inboundPort: string;
  inboundName: string;
  inboundUser: string;
  host: string;
  dnsMode: string;
  uid: number;
  process: string;
  processPath: string;
  specialProxy: string;
  specialRules: string;
  remoteDestination: string;
  dscp: number;
  sniffHost: string;
}

export interface Connection {
  id: string;
  metadata: ConnectionMetadata;
  upload: number;
  download: number;
  start: string;
  chains: string[];
  providerChains: string[];
  rule: string;
  rulePayload: string;
}

export interface ConnectionsData {
  downloadTotal: number;
  uploadTotal: number;
  connections: Connection[];
  memory?: number;
}

// Aggregated Statistics
export interface DomainStats {
  domain: string;
  ips: string[];
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
  lastSeen: string;
  rules: string[];
  chains: string[];
}

export interface IPStats {
  ip: string;
  domains: string[];
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
  lastSeen: string;
  asn?: string;
  geoIP?: GeoIPInfo;
  chains?: string[];
}

export interface HourlyStats {
  hour: string;
  upload: number;
  download: number;
  connections: number;
}

export interface TrafficTrendPoint {
  time: string;
  upload: number;
  download: number;
}

export interface DailyStats {
  date: string;
  upload: number;
  download: number;
  connections: number;
}

export interface ProxyStats {
  chain: string;
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
  lastSeen: string;
}

export interface DeviceStats {
  sourceIP: string;
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
  lastSeen: string;
}

export interface VendorDomainRule {
  id: number;
  pattern: string;
  matchType: "exact" | "suffix";
  priority: number;
  source: "manual" | "catalog" | "builtin";
  sourceKey: string | null;
  sourceRevision: string | null;
  confidence: "high" | "medium" | "low";
}

export interface TrafficVendor {
  id: number;
  slug: string;
  name: string;
  color: string;
  priority: number;
  enabled: boolean;
  rules: VendorDomainRule[];
}

export interface VendorTrafficTotal {
  vendorId: number;
  vendorSlug: string;
  vendorName: string;
  color: string;
  upload: number;
  download: number;
  connections: number;
}

export interface VendorDeviceTraffic extends VendorTrafficTotal {
  sourceIP: string;
}

export interface VendorTrafficPoint extends VendorTrafficTotal {
  time: string;
}

export type TransportProtocol = "tcp" | "udp" | "unknown";
export type ApplicationProtocol = "http" | "tls" | "quic" | "dns" | "other";
export type ProtocolConfidence = "exact" | "inferred" | "unknown";

export interface VendorProtocolTraffic extends VendorTrafficTotal {
  transport: TransportProtocol;
  applicationProtocol: ApplicationProtocol;
  confidence: ProtocolConfidence;
}

export interface VendorEndpointTraffic {
  endpointType: "domain" | "ip";
  endpoint: string;
  upload: number;
  download: number;
  connections: number;
  devices: number;
  transport: TransportProtocol;
  applicationProtocol: ApplicationProtocol;
  confidence: ProtocolConfidence;
  protocolShare: number;
  networkOwner: string | null;
  networkDomain: string | null;
  country: string | null;
  countryName: string | null;
  city: string | null;
  resolvedDomain: string | null;
  resolvedVendorId: number | null;
  resolvedVendorName: string | null;
  resolvedVendorSlug: string | null;
  resolutionSource: "observed" | "ptr" | null;
  resolutionConfidence: "high" | "medium" | null;
}

export interface VendorRecognitionQuality {
  totalTraffic: number;
  recognizedTraffic: number;
  domainObservedTraffic: number;
  totalRecognitionRate: number;
  domainObservationRate: number;
  recognizedDomainRate: number;
}

export interface UnknownVendorCandidate {
  registrableDomain: string;
  upload: number;
  download: number;
  connections: number;
  devices: number;
  lastSeen: string;
}

export interface VendorCatalogState {
  sourceKey: string;
  sourceUrl: string;
  revision: string | null;
  status: "idle" | "syncing" | "success" | "failed";
  rulesCount: number;
  conflictCount: number;
  excludedCount: number;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
}

export interface GatewaySnifferStatus {
  supported: boolean;
  enabled: boolean | null;
  backendType: "clash" | "surge";
  message: string;
}

export interface VendorAutomationResponse {
  catalog: VendorCatalogState;
  unknownCandidates: UnknownVendorCandidate[];
  sniffer: GatewaySnifferStatus;
}

export interface VendorStatsResponse {
  granularity: "hour" | "day";
  totals: VendorTrafficTotal[];
  byDevice: VendorDeviceTraffic[];
  trend: VendorTrafficPoint[];
  protocols: VendorProtocolTraffic[];
  quality: VendorRecognitionQuality;
}

export interface VendorEndpointStatsResponse {
  granularity: "hour" | "day";
  vendorId: number;
  endpoints: VendorEndpointTraffic[];
}

export type MonitorType = "icmp" | "tcp" | "http" | "dns";
export type MonitorStatus = "pending" | "up" | "down" | "degraded" | "paused";

export interface AvailabilityMonitor {
  id: number;
  name: string;
  type: MonitorType;
  target: string;
  port: number | null;
  httpMethod: string;
  expectedStatusMin: number;
  expectedStatusMax: number;
  dnsServer: string | null;
  dnsRecordType: string;
  dnsExpected: string | null;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  latencyWarningMs: number | null;
  enabled: boolean;
  status: MonitorStatus;
  lastCheckedAt: string | null;
  lastUpAt: string | null;
  lastDownAt: string | null;
  latencyMs: number | null;
  message: string | null;
}

export interface MonitorHistoryPoint {
  time: string;
  checks: number;
  upChecks: number;
  downChecks: number;
  degradedChecks: number;
  averageLatencyMs: number | null;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
  status: MonitorStatus;
}

export interface MonitorOverviewItem {
  monitorId: number;
  availability: number | null;
  checks: number;
  upChecks: number;
  downChecks: number;
  degradedChecks: number;
  history: MonitorHistoryPoint[];
}

export interface MonitorIncident {
  id: number;
  monitorId: number;
  monitorName: string;
  startedAt: string;
  endedAt: string | null;
  status: "open" | "resolved";
  cause: string | null;
  message: string | null;
}

export interface RuleStats {
  rule: string;
  finalProxy: string;
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
  lastSeen: string;
}

export interface RuleProxyMapping {
  rule: string;
  proxy: string;
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
}

export interface CountryStats {
  country: string;
  countryName: string;
  continent: string;
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
  lastSeen?: string;
}

// Per-proxy traffic breakdown for a specific domain or IP
export interface ProxyTrafficStats {
  chain: string;
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
}

export interface RuleChainFlowAll {
  nodes: Array<{
    name: string;
    layer: number;
    nodeType: "rule" | "group" | "proxy";
    totalUpload: number;
    totalDownload: number;
    totalConnections: number;
    rules: string[];
  }>;
  links: Array<{
    source: number;
    target: number;
    rules: string[];
  }>;
  rulePaths: Record<string, { nodeIndices: number[]; linkIndices: number[] }>;
  maxLayer: number;
}

// API Response Types
export interface StatsSummary {
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
  totalDomains: number;
  totalIPs: number;
  totalProxies: number;
  totalRules?: number;
  todayUpload?: number;
  todayDownload?: number;
  activeConnections?: number;
  topDomains: DomainStats[];
  topIPs: IPStats[];
  proxyStats: ProxyStats[];
  countryStats?: CountryStats[];
  deviceStats?: DeviceStats[];
  deviceDetailSourceIP?: string;
  deviceDomains?: DomainStats[];
  deviceIPs?: IPStats[];
  proxyDetailChain?: string;
  proxyDomains?: DomainStats[];
  proxyIPs?: IPStats[];
  ruleDetailName?: string;
  ruleDomains?: DomainStats[];
  ruleIPs?: IPStats[];
  ruleChainFlowAll?: RuleChainFlowAll;
  domainsPage?: { data: DomainStats[]; total: number };
  domainsPageQuery?: {
    offset: number;
    limit: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    search?: string;
  };
  ipsPage?: { data: IPStats[]; total: number };
  ipsPageQuery?: {
    offset: number;
    limit: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    search?: string;
  };
  trendStats?: TrafficTrendPoint[];
  ruleStats?: RuleStats[];
  hourlyStats: HourlyStats[];
}

export interface TimeRangeQuery {
  start?: string;
  end?: string;
  limit?: number;
}

// WebSocket Events
export interface StatsUpdateEvent {
  type: 'stats_update';
  data: ConnectionsData;
  timestamp: string;
}

export interface AggregatedUpdateEvent {
  type: 'aggregated_update';
  domains: DomainStats[];
  totalStats: {
    upload: number;
    download: number;
  };
  timestamp: string;
}

export type WebSocketEvent = StatsUpdateEvent | AggregatedUpdateEvent;

export interface AuthState {
  enabled: boolean;
  hasToken: boolean;
  forceAccessControlOff?: boolean;
  showcaseMode?: boolean;
}

// Surge API Types
export interface SurgeRequest {
  id: string;
  time: number;
  timestamp?: string;
  policyName: string;
  originalPolicyName: string;
  rule: string;
  processPath: string;
  remoteHost: string;
  remoteAddress?: string;
  remotePort?: number;
  localAddress?: string;
  localPort?: number;
  sourceAddress?: string;
  sourcePort?: number;
  inBytes: number;
  outBytes: number;
  inCurrentSpeed?: number;
  outCurrentSpeed?: number;
  inMaxSpeed?: number;
  outMaxSpeed?: number;
  status?: string;
  completed?: boolean;
  disconnected?: boolean;
  failed?: boolean;
  rejected?: boolean;
  startDate?: number;
  completedDate?: number;
  setupCompletedDate?: number;
  URL?: string;
  method?: string;
  notes?: string[];
}

export interface SurgeRequestsData {
  requests: SurgeRequest[];
}

export interface SurgePolicy {
  name: string;
  type: string;
  lineHash: string;
}

export interface SurgePolicyGroup {
  name: string;
  type: string;
  lineHash: string;
  policy: string;
  policies: string[];
  icon?: string;
}

export interface SurgePoliciesData {
  proxies: SurgePolicy[];
  groups: SurgePolicyGroup[];
}

// Surge Rules API Response
export interface SurgeRuleItem {
  type: string;
  payload: string;
  policy: string;
  raw: string;
}

export interface SurgeRulesData {
  rules: SurgeRuleItem[];
  availablePolicies: string[];
}

// Backend Type
export type BackendType = 'clash' | 'surge';

// Gateway utilities
export * from './gateway-utils.js';
export * from './geo-ip-utils.js';
