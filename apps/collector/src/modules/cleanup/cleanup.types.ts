/**
 * Data Retention Policy for Neko Master
 * 
 * Tiered storage strategy:
 * - Raw data (connection_logs): 7 days for detailed analysis
 * - Hourly aggregates: 30 days for recent trends
 * - Vendor daily aggregates: compact long-term history
 * - Availability: 30-day minute and 365-day hourly rollups
 * - Domain/IP stats: Permanent (continuously updated)
 */

export type RetentionPeriod = number | 'forever';

export interface RetentionConfig {
  // Raw connection logs retention (detailed per-connection data)
  connectionLogsDays: RetentionPeriod;
  
  // Hourly stats retention (for traffic trend charts)
  hourlyStatsDays: RetentionPeriod;

  // Vendor-by-device hourly rollups retention
  vendorHourlyDays: RetentionPeriod;

  vendorEndpointHourlyDays: RetentionPeriod;

  // Availability rollup retention
  monitorMinuteDays: RetentionPeriod;
  monitorHourlyDays: RetentionPeriod;
  
  // Auto-cleanup enabled
  autoCleanup: boolean;
  
  // Cleanup interval (hours)
  cleanupInterval: number;
}

export const DEFAULT_RETENTION: RetentionConfig = {
  connectionLogsDays: 7,      // Keep 7 days of raw logs
  hourlyStatsDays: 30,        // Keep 30 days of hourly data
  vendorHourlyDays: 365,      // Keep compact vendor hourly history for one year
  vendorEndpointHourlyDays: 90,
  monitorMinuteDays: 30,      // Keep detailed availability history for one month
  monitorHourlyDays: 365,     // Keep availability hourly history for one year
  autoCleanup: true,
  cleanupInterval: 24,        // Run cleanup every 24 hours
};
