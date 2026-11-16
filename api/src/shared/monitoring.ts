import * as Sentry from '@sentry/node';
import type { NextFunction, Request, Response } from 'express';

import { config } from '../config/index.js';

/** Only these route names can leave the API. Unknown and sensitive paths are grouped. */
export function monitoringRoute(method: string, path: string): string {
  if (method === 'GET' && path === '/api/v1/reservations/availability-check') return 'GET /api/v1/reservations/availability-check';
  if (method === 'GET' && path === '/api/v1/reservations/availability-calendar') return 'GET /api/v1/reservations/availability-calendar';
  if (method === 'GET' && path === '/api/v1/dashboard/overview') return 'GET /api/v1/dashboard/overview';
  if (method === 'POST' && path === '/api/v1/reservations') return 'POST /api/v1/reservations';
  if (method === 'GET' && /^\/api\/v1\/public\/stores\/[^/]+\/availability$/.test(path)) return 'GET /api/v1/public/stores/:slug/availability';
  return 'other';
}

export function sanitizeSentryError(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const trace = event.contexts?.trace;
  delete event.request;
  delete event.user;
  delete event.extra;
  delete event.breadcrumbs;
  delete event.message;
  delete event.logentry;
  delete event.server_name;
  delete event.transaction;
  delete event.threads;
  delete event.modules;
  event.contexts = trace ? { trace: { trace_id: trace.trace_id, span_id: trace.span_id } } : {};
  if (event.exception?.values) {
    for (const exception of event.exception.values) {
      exception.type = 'Error';
      exception.value = 'Server error';
      if (exception.mechanism) delete exception.mechanism.data;
      if (exception.stacktrace?.frames) {
        for (const frame of exception.stacktrace.frames) {
          delete frame.vars;
          delete frame.abs_path;
          delete frame.pre_context;
          delete frame.context_line;
          delete frame.post_context;
          if (frame.filename) {
            const filename = frame.filename.split(/[\\/]/).pop() ?? '';
            if (/^[a-zA-Z0-9_.-]+$/.test(filename)) frame.filename = filename;
            else delete frame.filename;
          }
          if (frame.function && !/^[a-zA-Z0-9_.<> -]+$/.test(frame.function)) delete frame.function;
        }
      }
    }
  }
  return event;
}

export function initMonitoring(): void {
  if (!config.SENTRY_DSN) return;
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    ...(config.SENTRY_RELEASE ? { release: config.SENTRY_RELEASE } : {}),
    tracesSampleRate: config.SENTRY_TRACES_SAMPLE_RATE,
    defaultIntegrations: false,
    enableOpenTelemetrySetup: true,
    enableRuntimeChannelInjection: false,
    beforeSend: sanitizeSentryError,
  });
}

export function requestMonitoring(req: Request, res: Response, next: NextFunction): void {
  if (!config.SENTRY_DSN || req.path === '/health') return next();
  const name = monitoringRoute(req.method, req.path);
  const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(req.method) ? req.method : 'OTHER';
  Sentry.startSpanManual({ name, op: 'http.server', attributes: { 'http.request.method': method } }, (span) => {
    let ended = false;
    const finish = (): void => {
      if (ended) return;
      ended = true;
      Sentry.setHttpStatus(span, res.statusCode);
      span.end();
    };
    res.once('finish', finish);
    res.once('close', finish);
    next();
  });
}

export function captureServerError(error: unknown, request?: Request): void {
  if (!config.SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    if (request) {
      scope.setTag('route', monitoringRoute(request.method, request.path));
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.requestId)) {
        scope.setTag('request_id', request.requestId);
      }
    }
    Sentry.captureException(error);
  });
}
