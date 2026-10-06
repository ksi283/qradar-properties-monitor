// src/alert-store.ts
// In-memory ring-buffer store for property change alerts.
// Emits 'alert' events so consumers (API, SSE) can react in real time.

import { EventEmitter } from 'events';
import crypto from 'crypto';
import {
  PropertyAlert,
  QRadarCustomProperty,
  ChangeKind,
  PropertyDiff,
} from './types';
import { config } from './config';
import { logger } from './logger';

export class AlertStore extends EventEmitter {
  private alerts: PropertyAlert[] = [];
  private readonly maxHistory: number;

  constructor(maxHistory = config.alertMaxHistory) {
    super();
    this.maxHistory = maxHistory;
  }

  push(alert: PropertyAlert): void {
    this.alerts.unshift(alert);          // newest first
    if (this.alerts.length > this.maxHistory) {
      this.alerts.length = this.maxHistory;
    }
    logger.info(`[ALERT] ${alert.kind} — ${alert.propertyName}`, {
      id: alert.propertyId,
      diff: alert.diff?.length ?? 0,
    });
    this.emit('alert', alert);
  }

  /** Return the most recent `limit` alerts, optionally filtered by kind */
  list(limit = 100, kind?: ChangeKind): PropertyAlert[] {
    const filtered = kind ? this.alerts.filter((a) => a.kind === kind) : this.alerts;
    return filtered.slice(0, limit);
  }

  get count(): number {
    return this.alerts.length;
  }

  // ── Factory helpers ─────────────────────────────────────────────────────

  static makeCreated(prop: QRadarCustomProperty): PropertyAlert {
    return {
      id: crypto.randomUUID(),
      kind: 'CREATED',
      timestamp: Date.now(),
      propertyId: prop.id,
      propertyName: prop.name,
      current: prop,
    };
  }

  static makeDeleted(prop: QRadarCustomProperty): PropertyAlert {
    return {
      id: crypto.randomUUID(),
      kind: 'DELETED',
      timestamp: Date.now(),
      propertyId: prop.id,
      propertyName: prop.name,
      previous: prop,
    };
  }

  static makeUpdated(
    previous: QRadarCustomProperty,
    current: QRadarCustomProperty,
    diff: PropertyDiff[]
  ): PropertyAlert {
    return {
      id: crypto.randomUUID(),
      kind: 'UPDATED',
      timestamp: Date.now(),
      propertyId: current.id,
      propertyName: current.name,
      previous,
      current,
      diff,
    };
  }
}
