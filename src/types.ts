// src/types.ts
// Shared domain types for the QRadar properties monitor

export type AuthMode = 'token' | 'basic';

export interface QRadarConfig {
  host: string;
  authMode: AuthMode;
  token?: string;
  username?: string;
  password?: string;
  verifySSL: boolean;
  apiVersion: string;
}

/** Raw property object returned by the QRadar REST API */
export interface QRadarCustomProperty {
  id: number;
  name: string;
  description?: string;
  property_type: 'STRING' | 'NUMERIC' | 'IP' | 'PORT' | 'TIME' | 'BOOLEAN';
  use_for_rule_engine: boolean;
  auto_discovered: boolean;
  /** Username of the QRadar user who owns / created this property */
  owner?: string;
  namespace?: string;
  creation_date?: number;
  modification_date?: number;
  enabled: boolean;
  // Regex expression(s) attached to this property
  expressions?: QRadarPropertyExpression[];
}

export interface QRadarPropertyExpression {
  id: number;
  regex: string;
  capture_group: number;
  enabled: boolean;
  log_source_type_id?: number;
  log_source_id?: number;
}

export type ChangeKind = 'CREATED' | 'UPDATED' | 'DELETED';

export interface PropertyAlert {
  id: string;
  kind: ChangeKind;
  timestamp: number;
  propertyId: number;
  propertyName: string;
  previous?: QRadarCustomProperty;
  current?: QRadarCustomProperty;
  diff?: PropertyDiff[];
}

export interface PropertyDiff {
  field: string;
  from: unknown;
  to: unknown;
}

export interface SyncState {
  lastSync: number | null;
  syncCount: number;
  errorCount: number;
  lastError: string | null;
  properties: Map<number, QRadarCustomProperty>;
}
