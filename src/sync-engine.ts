// src/sync-engine.ts
// Polls QRadar on a cron schedule, diffs against the last known state,
// and fires alerts for any CREATED / UPDATED / DELETED properties.

import cron from 'node-cron';
import { QRadarClient } from './qradar-client';
import { AlertStore } from './alert-store';
import { diffProperties, hasChanged } from './diff';
import { QRadarCustomProperty, SyncState } from './types';
import { config } from './config';
import { logger } from './logger';

export class SyncEngine {
  private client: QRadarClient;
  private alerts: AlertStore;
  private task: cron.ScheduledTask | null = null;
  private running = false;

  readonly state: SyncState = {
    lastSync: null,
    syncCount: 0,
    errorCount: 0,
    lastError: null,
    properties: new Map(),
  };

  constructor(client: QRadarClient, alerts: AlertStore) {
    this.client = client;
    this.alerts = alerts;
  }

  /** Verify connectivity then start the polling schedule */
  async start(): Promise<void> {
    logger.info('Verifying QRadar connectivity…');
    await this.client.ping();
    logger.info('QRadar connection OK');

    // Run an initial sync immediately
    await this.sync();

    this.task = cron.schedule(config.syncCron, async () => {
      if (this.running) {
        logger.warn('Previous sync still running — skipping tick');
        return;
      }
      await this.sync();
    });

    logger.info(`Sync scheduled: ${config.syncCron}`);
  }

  stop(): void {
    this.task?.stop();
    logger.info('Sync engine stopped');
  }

  /** Perform one full sync cycle */
  async sync(): Promise<void> {
    this.running = true;
    try {
      const fresh = await this.client.listProperties();
      this.applyDiff(fresh);
      this.state.lastSync = Date.now();
      this.state.syncCount++;
      logger.debug(`Sync complete — ${fresh.length} properties`, {
        syncCount: this.state.syncCount,
      });
    } catch (err) {
      this.state.errorCount++;
      this.state.lastError = err instanceof Error ? err.message : String(err);
      logger.error('Sync failed', { error: this.state.lastError });
    } finally {
      this.running = false;
    }
  }

  /** Get the current snapshot as an array */
  snapshot(): QRadarCustomProperty[] {
    return [...this.state.properties.values()];
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private applyDiff(fresh: QRadarCustomProperty[]): void {
    const freshMap = new Map(fresh.map((p) => [p.id, p]));
    const prevMap = this.state.properties;

    // Detect CREATED
    for (const [id, prop] of freshMap) {
      if (!prevMap.has(id)) {
        logger.info(`Property CREATED: [${id}] ${prop.name}`);
        this.alerts.push(AlertStore.makeCreated(prop));
      }
    }

    // Detect UPDATED
    for (const [id, curr] of freshMap) {
      const prev = prevMap.get(id);
      if (prev && hasChanged(prev, curr)) {
        const diff = diffProperties(prev, curr);
        logger.info(`Property UPDATED: [${id}] ${curr.name} (${diff.length} changes)`);
        this.alerts.push(AlertStore.makeUpdated(prev, curr, diff));
      }
    }

    // Detect DELETED
    for (const [id, prev] of prevMap) {
      if (!freshMap.has(id)) {
        logger.info(`Property DELETED: [${id}] ${prev.name}`);
        this.alerts.push(AlertStore.makeDeleted(prev));
      }
    }

    // Replace state with fresh snapshot
    this.state.properties = freshMap;
  }
}
