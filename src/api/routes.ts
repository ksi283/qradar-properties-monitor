// src/api/routes.ts
// Express router — REST API + Server-Sent Events (SSE) stream

import { Router, Request, Response } from 'express';
import { SyncEngine } from '../sync-engine';
import { AlertStore } from '../alert-store';
import { QRadarClient } from '../qradar-client';
import { ChangeKind } from '../types';

export function buildRouter(
  engine: SyncEngine,
  alerts: AlertStore,
  client: QRadarClient
): Router {
  const router = Router();

  // ── Status ──────────────────────────────────────────────────────────────

  /**
   * GET /api/status
   * Returns sync state, uptime, and alert counts.
   */
  router.get('/status', (_req: Request, res: Response) => {
    const { lastSync, syncCount, errorCount, lastError, properties } = engine.state;
    res.json({
      lastSync: lastSync ? new Date(lastSync).toISOString() : null,
      syncCount,
      errorCount,
      lastError,
      propertyCount: properties.size,
      alertCount: alerts.count,
    });
  });

  // ── Properties ───────────────────────────────────────────────────────────

  /**
   * GET /api/properties
   * Returns the current in-memory snapshot.
   * Query: ?search=<name substring>  ?enabled=true|false  ?type=STRING|NUMERIC…
   */
  router.get('/properties', (req: Request, res: Response) => {
    let props = engine.snapshot();

    const search = (req.query['search'] as string | undefined)?.toLowerCase();
    if (search) props = props.filter((p) => p.name.toLowerCase().includes(search));

    const enabledFilter = req.query['enabled'];
    if (enabledFilter !== undefined) {
      const want = enabledFilter === 'true';
      props = props.filter((p) => p.enabled === want);
    }

    const typeFilter = req.query['type'] as string | undefined;
    if (typeFilter) props = props.filter((p) => p.property_type === typeFilter.toUpperCase());

    res.json({ count: props.length, properties: props });
  });

  /**
   * GET /api/properties/:id
   * Live fetch from QRadar (always fresh).
   */
  router.get('/properties/:id', async (req: Request, res: Response) => {
    const id = parseInt(req.params['id'] ?? '', 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid property id' });
    try {
      const prop = await client.getProperty(id);
      return res.json(prop);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status ?? 500;
      return res.status(status).json({ error: 'Failed to fetch property' });
    }
  });

  /**
   * POST /api/properties
   * Create a new custom property.
   * Body: { name, property_type, description?, enabled?, use_for_rule_engine?, expressions? }
   */
  router.post('/properties', async (req: Request, res: Response) => {
    try {
      const prop = await client.createProperty(req.body);
      await engine.sync();              // refresh snapshot immediately
      return res.status(201).json(prop);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status ?? 500;
      return res.status(status).json({ error: 'Failed to create property' });
    }
  });

  /**
   * PUT /api/properties/:id
   * Update an existing property (partial).
   */
  router.put('/properties/:id', async (req: Request, res: Response) => {
    const id = parseInt(req.params['id'] ?? '', 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid property id' });
    try {
      const prop = await client.updateProperty(id, req.body);
      await engine.sync();
      return res.json(prop);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status ?? 500;
      return res.status(status).json({ error: 'Failed to update property' });
    }
  });

  /**
   * DELETE /api/properties/:id
   */
  router.delete('/properties/:id', async (req: Request, res: Response) => {
    const id = parseInt(req.params['id'] ?? '', 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid property id' });
    try {
      await client.deleteProperty(id);
      await engine.sync();
      return res.status(204).send();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status ?? 500;
      return res.status(status).json({ error: 'Failed to delete property' });
    }
  });

  // ── Expressions ──────────────────────────────────────────────────────────

  /**
   * POST /api/properties/:id/expressions
   * Add a regex expression to a property.
   */
  router.post('/properties/:id/expressions', async (req: Request, res: Response) => {
    const id = parseInt(req.params['id'] ?? '', 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid property id' });
    const { regex, capture_group, log_source_type_id } = req.body as {
      regex: string;
      capture_group?: number;
      log_source_type_id?: number;
    };
    if (!regex) return res.status(400).json({ error: 'regex is required' });
    try {
      const expr = await client.createExpression(id, regex, capture_group ?? 1, log_source_type_id);
      await engine.sync();
      return res.status(201).json(expr);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status ?? 500;
      return res.status(status).json({ error: 'Failed to create expression' });
    }
  });

  /**
   * PUT /api/expressions/:exprId
   * Update a regex expression.
   */
  router.put('/expressions/:exprId', async (req: Request, res: Response) => {
    const exprId = parseInt(req.params['exprId'] ?? '', 10);
    if (isNaN(exprId)) return res.status(400).json({ error: 'Invalid expression id' });
    try {
      const expr = await client.updateExpression(exprId, req.body);
      await engine.sync();
      return res.json(expr);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status ?? 500;
      return res.status(status).json({ error: 'Failed to update expression' });
    }
  });

  /**
   * DELETE /api/expressions/:exprId
   */
  router.delete('/expressions/:exprId', async (req: Request, res: Response) => {
    const exprId = parseInt(req.params['exprId'] ?? '', 10);
    if (isNaN(exprId)) return res.status(400).json({ error: 'Invalid expression id' });
    try {
      await client.deleteExpression(exprId);
      await engine.sync();
      return res.status(204).send();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status ?? 500;
      return res.status(status).json({ error: 'Failed to delete expression' });
    }
  });

  // ── Alerts ───────────────────────────────────────────────────────────────

  /**
   * GET /api/alerts
   * Query: ?limit=<n>  ?kind=CREATED|UPDATED|DELETED
   */
  router.get('/alerts', (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query['limit'] as string) ?? '100', 10), 500);
    const kind = req.query['kind'] as ChangeKind | undefined;
    res.json({ alerts: alerts.list(limit, kind) });
  });

  /**
   * GET /api/alerts/stream
   * Server-Sent Events — push new alerts in real time.
   */
  router.get('/alerts/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send heartbeat every 30 s to keep proxy connections alive
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30_000);

    const onAlert = (alert: unknown) => {
      res.write(`data: ${JSON.stringify(alert)}\n\n`);
    };

    alerts.on('alert', onAlert);

    req.on('close', () => {
      clearInterval(heartbeat);
      alerts.off('alert', onAlert);
    });
  });

  // ── Manual sync trigger ──────────────────────────────────────────────────

  /**
   * POST /api/sync
   * Trigger an immediate sync outside the cron schedule.
   */
  router.post('/sync', async (_req: Request, res: Response) => {
    await engine.sync();
    res.json({ ok: true, lastSync: engine.state.lastSync });
  });

  return router;
}
