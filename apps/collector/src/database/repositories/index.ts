/**
 * Database Repositories
 *
 * This module exports all repository classes for database operations.
 * Use these repositories to perform specific domain operations.
 */

export { BaseRepository } from './base.repository.js';
export { DomainRepository } from './domain.repository.js';
export { BackendRepository, type BackendConfig } from './backend.repository.js';
export { AuthRepository } from './auth.repository.js';
export { SurgeRepository } from './surge.repository.js';
export { TimeseriesRepository } from './timeseries.repository.js';
export { CountryRepository } from './country.repository.js';
export { DeviceRepository } from './device.repository.js';
export { ProxyRepository } from './proxy.repository.js';
export { RuleRepository } from './rule.repository.js';
export { IPRepository } from './ip.repository.js';
export { ConfigRepository, type GeoLookupConfig, type GeoLookupProvider } from './config.repository.js';
export { TrafficWriterRepository, type TrafficUpdate } from './traffic-writer.repository.js';
export { HealthRepository, type HealthLogRow, type HealthStatus } from './health.repository.js';
export { VendorRepository, type VendorInput } from './vendor.repository.js';
export {
  MonitorRepository,
  type MonitorInput,
  type MonitorCheckResult,
  type MonitorTransition,
} from './monitor.repository.js';
