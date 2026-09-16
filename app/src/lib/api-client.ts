"use client";

/**
 * Typed fetch wrapper over @drezivo/contracts (TRD §4). Every screen in this repo calls
 * the Express API through this client — Next.js never re-implements a business write here
 * (TRD §1: "do not duplicate business writes in Next.js route handlers"). Request and
 * response shapes always come from @drezivo/contracts; this file must never declare its
 * own hand-written API type.
 *
 * Every response uses the one contract envelope, discriminated on `success`:
 *   { success: true,  data: T, request_id }
 *   { success: false, error: { code, message, fields? }, request_id }
 * This client unwraps `data` on success (callers type against the contract's data-payload
 * types) and throws `ApiError` carrying the failure envelope's details on error.
 *
 * Binding to Clerk: `getToken` and `organization` are read FRESH on every call, inside
 * the request function, never captured once and reused. TRD §3 calls out that a
 * background request fired from a stale closure after the user switches organizations in
 * another tab must not silently run against the old organization — reading both values at
 * call time (not at hook-mount time) is what prevents that.
 */

import { useAuth, useOrganization } from "@clerk/nextjs";
import { useCallback } from "react";
import type { ErrorEnvelope, ErrorField } from "@drezivo/contracts";

const API_BASE_URL = process.env["NEXT_PUBLIC_API_BASE_URL"];

/** Thrown for every non-2xx (or malformed) response. Carries the contract failure envelope's details. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly fields?: ErrorField[] | undefined;

  constructor(status: number, code: string, message: string, requestId: string, fields?: ErrorField[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.fields = fields;
  }
}

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestOptions {
  method: HttpMethod;
  body?: unknown | undefined;
  idempotencyKey?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface DrezivoApiClient {
  get<TResponse>(path: string, signal?: AbortSignal): Promise<TResponse>;
  post<TResponse>(
    path: string,
    body: unknown,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<TResponse>;
  patch<TResponse>(
    path: string,
    body: unknown,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<TResponse>;
  del<TResponse>(path: string, idempotencyKey: string, signal?: AbortSignal): Promise<TResponse>;
}

/**
 * Every mutation must be called through useSubmitGuard, which is the only supported way
 * to obtain an idempotency key (TRD §4). A caller that reaches this client with a
 * mutating method and no key has bypassed the guard — fail closed instead of sending an
 * un-keyed write the API cannot deduplicate.
 */
function assertMutationHasIdempotencyKey(method: HttpMethod, idempotencyKey: string | undefined): void {
  if (method !== "GET" && !idempotencyKey) {
    throw new Error(
      `Drezivo api-client: ${method} is a mutation and must go through useSubmitGuard so it ` +
        "carries an Idempotency-Key (TRD §4). Refusing to send it unkeyed."
    );
  }
}

export function useApiClient(): DrezivoApiClient {
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  const request = useCallback(
    async <TResponse>(path: string, options: RequestOptions): Promise<TResponse> => {
      assertMutationHasIdempotencyKey(options.method, options.idempotencyKey);

      if (!API_BASE_URL) {
        throw new Error(
          "NEXT_PUBLIC_API_BASE_URL is not configured. See CONTRIBUTING.md for required env vars."
        );
      }
      if (!organization) {
        throw new Error(
          "No active Clerk organization in context; refusing to send a request with no tenant scope."
        );
      }

      const token = await getToken();
      const requestId = crypto.randomUUID();

      const response = await fetch(`${API_BASE_URL}${path}`, {
        method: options.method,
        ...(options.signal ? { signal: options.signal } : {}),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
          "X-Drezivo-Organization-Id": organization.id,
          "X-Request-Id": requestId,
          ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        // No automatic retry here for ANY method, including GET: TanStack Query owns read
        // retries (lib/query-client.tsx); a non-idempotent write is never retried by this
        // client, only replayed deliberately by the caller reusing the same guard key.
      });

      const payload = await safeParseJson(response);

      if (!response.ok || isFailureEnvelope(payload)) {
        throw toApiError(response.status, payload, requestId);
      }

      if (!isSuccessEnvelope(payload)) {
        // 2xx without a parseable envelope: the one shape the contract forbids. Surface it
        // as an error instead of returning an undefined `data` cast to TResponse.
        throw new ApiError(
          response.status,
          "unknown_error",
          "The request returned a malformed response.",
          requestId
        );
      }

      return payload.data as TResponse;
    },
    [getToken, organization]
  );

  return {
    get: (path, signal) => request(path, { method: "GET", signal }),
    post: (path, body, idempotencyKey, signal) =>
      request(path, { method: "POST", body, idempotencyKey, signal }),
    patch: (path, body, idempotencyKey, signal) =>
      request(path, { method: "PATCH", body, idempotencyKey, signal }),
    del: (path, idempotencyKey, signal) => request(path, { method: "DELETE", idempotencyKey, signal }),
  };
}

async function safeParseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFailureEnvelope(value: unknown): value is ErrorEnvelope {
  if (!isRecord(value) || value["success"] !== false) return false;
  const error = value["error"];
  if (!isRecord(error)) return false;
  return (
    typeof error["code"] === "string" &&
    typeof error["message"] === "string" &&
    typeof value["request_id"] === "string"
  );
}

function isSuccessEnvelope(value: unknown): value is { success: true; data: unknown } {
  return isRecord(value) && value["success"] === true && "data" in value;
}

function toApiError(status: number, payload: unknown, fallbackRequestId: string): ApiError {
  if (isFailureEnvelope(payload)) {
    return new ApiError(
      status,
      payload.error.code,
      payload.error.message,
      payload.request_id,
      payload.error.fields
    );
  }
  // Non-JSON body (e.g. a raw 502 from the load balancer) — report the status without
  // inventing envelope details the server never sent.
  return new ApiError(
    status,
    "unknown_error",
    "The request failed and returned no usable error body.",
    fallbackRequestId
  );
}
