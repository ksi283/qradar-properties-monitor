// src/index.ts
// Application entry point — wires everything together and starts the server

import { config } from './config';
import { logger } from './logger';
import { QRadarClient } from './qradar-client';
import { AlertStore } from './alert-store';
import { SyncEngine } from './sync-engine';
import { buildApp } from './api/server';

async function main(): Promise<void> {
  logger.info('QRadar Properties Monitor starting…');
  logger.info(`Auth mode: ${config.qradar.authMode}`);
  logger.info(`Target: ${config.qradar.host}`);

  const client = new QRadarClient(config.qradar);
  const alerts = new AlertStore();
  const engine = new SyncEngine(client, alerts);
  const app = buildApp(engine, alerts, client);

  // Start HTTP server first so the dashboard is reachable even during initial sync
  const server = app.listen(config.port, () => {
    logger.info(`Dashboard: http://localhost:${config.port}`);
    logger.info(`API base:  http://localhost:${config.port}/api`);
  });

  try {
    await engine.start();
  } catch (err) {
    logger.error('Failed to start sync engine', { error: (err as Error).message });
    logger.error('Check QRADAR_HOST and credentials in .env then restart.');
    // Server stays up so /api/status is still accessible for diagnostics
  }

  // Graceful shutdown
  const shutdown = (): void => {
    logger.info('Shutting down…');
    engine.stop();
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
