// src/api/server.ts
// Builds and returns the Express application

import express from 'express';
import path from 'path';
import { buildRouter } from './routes';
import { SyncEngine } from '../sync-engine';
import { AlertStore } from '../alert-store';
import { QRadarClient } from '../qradar-client';

export function buildApp(
  engine: SyncEngine,
  alerts: AlertStore,
  client: QRadarClient
): express.Application {
  const app = express();

  app.use(express.json());

  // Serve the static dashboard
  app.use(express.static(path.join(__dirname, '../../public')));

  // API routes under /api
  app.use('/api', buildRouter(engine, alerts, client));

  // Fallback: serve dashboard for any non-API GET (SPA-style)
  app.get(/^(?!\/api).*$/, (_req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  return app;
}
