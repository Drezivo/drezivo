import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '../shared/errors.js';

interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * The one boundary where request input is validated (AGENTS.md: "Validate request body,
 * params, and query at the route boundary" / "Do not call `.parse()` manually inside
 * controllers"). Parsed, typed results REPLACE `req.body`/`req.query`/`req.params` so every
 * downstream controller/service receives already-validated, already-typed input — never the
 * raw untyped request object.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        req.params = schemas.params.parse(req.params);
      }
      if (schemas.query) {
        // Zod's parsed query result is assigned back onto req.query; Express 5 types req.query
        // as ParsedQs, so the boundary result is narrowed via the route's own typed accessor
        // (see each module's *.schemas.ts + controller for the read side) rather than widened
        // here with a cast.
        Object.assign(req.query, schemas.query.parse(req.query));
      }
      if (schemas.body) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (error) {
      next(toValidationError(error));
    }
  };
}

function toValidationError(error: unknown): ValidationError {
  if (error && typeof error === 'object' && 'issues' in error) {
    const zodError = error as { issues: Array<{ path: (string | number)[]; message: string }> };
    const fields = zodError.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return new ValidationError('Request validation failed.', fields);
  }
  return new ValidationError('Request validation failed.');
}
