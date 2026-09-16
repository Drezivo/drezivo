import pino from 'pino';

import { config } from '../config/index.js';

/**
 * Single shared logger instance. AGENTS.md forbids `console.log` in production code and
 * forbids logging secrets/tokens/PII — every call site is responsible for only passing
 * fields that are safe to persist in centralized logs (request_id, tenant_id, route, status,
 * timing). Never pass a raw request body, Authorization header, or file contents here.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.secret',
      '*.apiKey',
    ],
    censor: '[redacted]',
  },
  base: { service: 'drezivo-api' },
});

export type Logger = typeof logger;
