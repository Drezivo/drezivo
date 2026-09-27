import type { ErrorField } from '@drezivo/contracts';
import { apiEnvelope } from '@drezivo/contracts';
import { z } from 'zod';

import { staticStorefrontClient } from './static-storefront-client';

const responseEnvelope = apiEnvelope(z.unknown());
type ParsedResponseEnvelope = z.infer<typeof responseEnvelope>;
type FailureEnvelope = Extract<ParsedResponseEnvelope, { success: false }>;

/**
 * Retained envelope helper for shared tests and for the later API-reconnect phase.
 * The active storefront client below is intentionally static and performs no HTTP.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly requestId: string | undefined,
    public readonly status: number,
    public readonly fields?: ErrorField[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function toApiError(status: number, envelope: FailureEnvelope): ApiError {
  return new ApiError(
    envelope.error.code,
    envelope.error.message,
    envelope.request_id,
    status,
    envelope.error.fields,
  );
}

async function parseJsonOrUndefined(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function unwrapSuccessData<T>(response: Response): Promise<T> {
  const payload = await parseJsonOrUndefined(response);
  const parsed = responseEnvelope.safeParse(payload);

  if (!response.ok) {
    if (parsed.success && !parsed.data.success) {
      throw toApiError(response.status, parsed.data);
    }
    throw new ApiError('unknown_error', 'Something went wrong. Please try again.', undefined, response.status);
  }

  if (!parsed.success) {
    throw new ApiError('unknown_error', 'The API returned a malformed response.', undefined, response.status);
  }

  if (!parsed.data.success) {
    throw toApiError(response.status, parsed.data);
  }

  return parsed.data.data as T;
}

/**
 * Static storefront phase: all public storefront reads/writes resolve locally.
 * Keeping the familiar export name avoids coupling pages to the temporary data source.
 */
export const publicApiClient = staticStorefrontClient;
