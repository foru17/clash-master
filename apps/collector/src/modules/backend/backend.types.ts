/**
 * Backend module type definitions
 */

export interface BackendConfig {
  id: number;
  name: string;
  url: string;
  token: string;
  type: 'clash' | 'surge' | 'passwall';
  enabled: boolean;
  is_active: boolean;
  listening: boolean;
  created_at: string;
  updated_at: string;
}

// Re-export from db.ts for compatibility
export type { BackendConfig as BackendConfigFromDb } from '../db/db.js';

export interface CreateBackendInput {
  name: string;
  url: string;
  token?: string;
  type?: 'clash' | 'surge' | 'passwall';
}

export interface UpdateBackendInput {
  name?: string;
  url?: string;
  token?: string;
  type?: 'clash' | 'surge' | 'passwall';
  enabled?: boolean;
  listening?: boolean;
}

export interface BackendHealthInfo {
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastChecked: number;
  message?: string;
  latency?: number;
  serverLatency?: number;
}

export interface BackendResponse {
  id: number;
  name: string;
  url: string;
  token: string;
  type: 'clash' | 'surge' | 'passwall';
  enabled: boolean;
  is_active: boolean;
  listening: boolean;
  created_at: string;
  updated_at: string;
  health?: BackendHealthInfo;
}

export interface TestConnectionInput {
  url: string;
  token?: string;
  type?: 'clash' | 'surge' | 'passwall';
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
}

export interface BackendActivationResult {
  message: string;
}

export interface BackendListeningResult {
  message: string;
}

export interface ClearDataResult {
  message: string;
}

export interface CreateBackendResult {
  id: number;
  isActive: boolean;
  message: string;
  agentToken?: string;
}

export interface RotateAgentTokenResult {
  message: string;
  agentToken: string;
}

export interface BackendHealthPoint {
  time: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  latency_ms: number | null;
  server_latency_ms: number | null;
  message: string | null;
}

export interface BackendHealthHistory {
  backendId: number;
  backendName: string;
  points: BackendHealthPoint[];
}
