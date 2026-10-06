// src/qradar-client.ts
// QRadar REST API client — supports both SEC token and HTTP Basic authentication.
//
// Key endpoints used:
//   GET  /api/config/event_sources/custom_properties/property_expressions
//   GET  /api/config/event_sources/custom_properties/property_expressions/{id}
//   GET  /api/config/event_sources/custom_properties/regex_properties
//   GET  /api/config/event_sources/custom_properties/regex_properties/{id}
//   POST /api/config/event_sources/custom_properties/regex_properties
//   PUT  /api/config/event_sources/custom_properties/regex_properties/{id}
//   DEL  /api/config/event_sources/custom_properties/regex_properties/{id}
//   GET  /api/system/information/versions   (connectivity probe)

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import https from 'https';
import { QRadarConfig, QRadarCustomProperty, QRadarPropertyExpression } from './types';
import { logger } from './logger';

/** Thin helper wrapping a raw expression record from the QRadar API */
interface RawExpression {
  id: number;
  regex: string;
  capture_group: number;
  enabled: boolean;
  log_source_type_id?: number;
  log_source_id?: number;
}

/** Raw property record from GET /api/config/event_sources/custom_properties/regex_properties */
interface RawRegexProperty {
  id: number;
  name: string;
  description?: string;
  property_type: string;
  use_for_rule_engine: boolean;
  auto_discovered: boolean;
  namespace?: string;
  creation_date?: number;
  modification_date?: number;
  enabled: boolean;
}

export class QRadarClient {
  private http: AxiosInstance;
  private readonly cfg: QRadarConfig;

  constructor(cfg: QRadarConfig) {
    this.cfg = cfg;

    const headers: Record<string, string> = {
      'Accept': `application/json`,
      'Content-Type': 'application/json',
      'Version': cfg.apiVersion,
    };

    // SEC token takes priority; fall back to Basic auth via axios auth option
    if (cfg.authMode === 'token' && cfg.token) {
      headers['SEC'] = cfg.token;
    }

    const axiosCfg: AxiosRequestConfig = {
      baseURL: cfg.host,
      headers,
      ...(cfg.authMode === 'basic' && cfg.username && cfg.password
        ? { auth: { username: cfg.username, password: cfg.password } }
        : {}),
      httpsAgent: new https.Agent({ rejectUnauthorized: cfg.verifySSL }),
      timeout: 30_000,
    };

    this.http = axios.create(axiosCfg);

    // Response interceptor — log errors clearly
    this.http.interceptors.response.use(
      (res) => res,
      (err) => {
        const status = err.response?.status;
        const detail = err.response?.data?.message ?? err.message;
        logger.error('QRadar API error', { status, detail, url: err.config?.url });
        return Promise.reject(err);
      }
    );
  }

  // ── Connectivity ────────────────────────────────────────────────────────

  /** Probe QRadar to verify credentials and connectivity */
  async ping(): Promise<void> {
    await this.http.get('/api/system/information/versions');
  }

  // ── Custom Properties ───────────────────────────────────────────────────

  /**
   * Fetch all regex-based custom event/flow properties.
   * Optionally pass a `fields` projection to reduce payload size.
   */
  async listProperties(filter?: string): Promise<QRadarCustomProperty[]> {
    const params: Record<string, string> = {};
    if (filter) params['filter'] = filter;

    const [propRes, exprRes] = await Promise.all([
      this.http.get<RawRegexProperty[]>(
        '/api/config/event_sources/custom_properties/regex_properties',
        { params }
      ),
      this.http.get<RawExpression[]>(
        '/api/config/event_sources/custom_properties/property_expressions'
      ),
    ]);

    const expressionsByProp = new Map<number, QRadarPropertyExpression[]>();
    for (const expr of exprRes.data) {
      // The expressions endpoint returns objects that include a regex_property_identifier
      // In QRadar API v12+ expressions carry a `regex_property_identifier` field
      const rawExpr = expr as RawExpression & { regex_property_identifier?: number };
      const propId = rawExpr.regex_property_identifier;
      if (propId !== undefined) {
        if (!expressionsByProp.has(propId)) expressionsByProp.set(propId, []);
        expressionsByProp.get(propId)!.push(this.mapExpression(expr));
      }
    }

    return propRes.data.map((raw) => ({
      id: raw.id,
      name: raw.name,
      description: raw.description,
      property_type: raw.property_type as QRadarCustomProperty['property_type'],
      use_for_rule_engine: raw.use_for_rule_engine,
      auto_discovered: raw.auto_discovered,
      namespace: raw.namespace,
      creation_date: raw.creation_date,
      modification_date: raw.modification_date,
      enabled: raw.enabled,
      expressions: expressionsByProp.get(raw.id) ?? [],
    }));
  }

  /** Fetch a single property by ID */
  async getProperty(id: number): Promise<QRadarCustomProperty> {
    const [propRes, exprRes] = await Promise.all([
      this.http.get<RawRegexProperty>(
        `/api/config/event_sources/custom_properties/regex_properties/${id}`
      ),
      this.http.get<RawExpression[]>(
        '/api/config/event_sources/custom_properties/property_expressions',
        { params: { filter: `regex_property_identifier="${id}"` } }
      ),
    ]);

    const raw = propRes.data;
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description,
      property_type: raw.property_type as QRadarCustomProperty['property_type'],
      use_for_rule_engine: raw.use_for_rule_engine,
      auto_discovered: raw.auto_discovered,
      namespace: raw.namespace,
      creation_date: raw.creation_date,
      modification_date: raw.modification_date,
      enabled: raw.enabled,
      expressions: exprRes.data.map((e) => this.mapExpression(e)),
    };
  }

  /** Create a new regex custom property */
  async createProperty(
    body: Omit<QRadarCustomProperty, 'id' | 'auto_discovered' | 'creation_date' | 'modification_date'>
  ): Promise<QRadarCustomProperty> {
    const res = await this.http.post<RawRegexProperty>(
      '/api/config/event_sources/custom_properties/regex_properties',
      body
    );
    return this.getProperty(res.data.id);
  }

  /** Update an existing property (partial update) */
  async updateProperty(
    id: number,
    body: Partial<Omit<QRadarCustomProperty, 'id'>>
  ): Promise<QRadarCustomProperty> {
    await this.http.post(
      `/api/config/event_sources/custom_properties/regex_properties/${id}`,
      body
    );
    return this.getProperty(id);
  }

  /** Delete a custom property by ID */
  async deleteProperty(id: number): Promise<void> {
    await this.http.delete(
      `/api/config/event_sources/custom_properties/regex_properties/${id}`
    );
  }

  // ── Expressions ─────────────────────────────────────────────────────────

  /** Create a regex expression on an existing property */
  async createExpression(
    propertyId: number,
    regex: string,
    captureGroup = 1,
    logSourceTypeId?: number
  ): Promise<QRadarPropertyExpression> {
    const body = {
      regex_property_identifier: propertyId,
      regex,
      capture_group: captureGroup,
      enabled: true,
      ...(logSourceTypeId ? { log_source_type_id: logSourceTypeId } : {}),
    };
    const res = await this.http.post<RawExpression>(
      '/api/config/event_sources/custom_properties/property_expressions',
      body
    );
    return this.mapExpression(res.data);
  }

  /** Update a regex expression */
  async updateExpression(
    exprId: number,
    updates: Partial<Pick<QRadarPropertyExpression, 'regex' | 'capture_group' | 'enabled'>>
  ): Promise<QRadarPropertyExpression> {
    const res = await this.http.post<RawExpression>(
      `/api/config/event_sources/custom_properties/property_expressions/${exprId}`,
      updates
    );
    return this.mapExpression(res.data);
  }

  /** Delete a regex expression */
  async deleteExpression(exprId: number): Promise<void> {
    await this.http.delete(
      `/api/config/event_sources/custom_properties/property_expressions/${exprId}`
    );
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private mapExpression(raw: RawExpression): QRadarPropertyExpression {
    return {
      id: raw.id,
      regex: raw.regex,
      capture_group: raw.capture_group,
      enabled: raw.enabled,
      log_source_type_id: raw.log_source_type_id,
      log_source_id: raw.log_source_id,
    };
  }
}
