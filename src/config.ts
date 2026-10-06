// src/config.ts
// Loads and validates environment configuration

import 'dotenv/config';
import { QRadarConfig } from './types';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function loadQRadarConfig(): QRadarConfig {
  const host = requireEnv('QRADAR_HOST').replace(/\/$/, '');
  const token = process.env['QRADAR_TOKEN'];
  const username = process.env['QRADAR_USERNAME'];
  const password = process.env['QRADAR_PASSWORD'];

  if (!token && !(username && password)) {
    throw new Error(
      'Authentication required: set QRADAR_TOKEN or both QRADAR_USERNAME and QRADAR_PASSWORD'
    );
  }

  return {
    host,
    authMode: token ? 'token' : 'basic',
    token,
    username,
    password,
    verifySSL: process.env['QRADAR_VERIFY_SSL'] !== 'false',
    apiVersion: process.env['QRADAR_API_VERSION'] ?? '21.0',
  };
}

export const config = {
  qradar: loadQRadarConfig(),
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  syncCron: process.env['SYNC_CRON'] ?? '*/1 * * * *',
  alertMaxHistory: parseInt(process.env['ALERT_MAX_HISTORY'] ?? '500', 10),
  logLevel: process.env['LOG_LEVEL'] ?? 'info',
};
