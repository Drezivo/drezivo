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
 * Binding to Clerk: the latest `getToken` and `orgId` values are dependencies of the request
 * callback, so a render caused by an organization switch replaces the callback before the next
 * request. TRD §3 calls out that a background request fired from a stale closure after the user
 * switches organizations in another tab must not silently run against the old organization.
 */

import { useAuth } from "@clerk/nextjs";
import { useCallback } from "react";
import { apiEnvelope, type ErrorField } from "@drezivo/contracts";
import { z } from "zod";
import { useWorkspace } from "./workspace-context";

const API_BASE_URL = process.env["NEXT_PUBLIC_API_BASE_URL"];
const responseEnvelope = apiEnvelope(z.unknown());
type ParsedResponseEnvelope = z.infer<typeof responseEnvelope>;
type FailureEnvelope = Extract<ParsedResponseEnvelope, { success: false }>;

/** Thrown for every non-2xx (or malformed) response. Carries the contract failure envelope's details. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly fields?: ErrorField[] | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId: string,
    fields?: ErrorField[]
  ) {
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
  branchId?: string | undefined;
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
function assertMutationHasIdempotencyKey(
  method: HttpMethod,
  idempotencyKey: string | undefined
): void {
  if (method !== "GET" && !idempotencyKey) {
    throw new Error(
      `Drezivo api-client: ${method} is a mutation and must go through useSubmitGuard so it ` +
        "carries an Idempotency-Key (TRD §4). Refusing to send it unkeyed."
    );
  }
}

export function useApiClient(): DrezivoApiClient {
  const { getToken, orgId } = useAuth();
  const { activeBranchId } = useWorkspace();

  const request = useCallback(
    async <TResponse>(path: string, options: RequestOptions): Promise<TResponse> => {
      assertMutationHasIdempotencyKey(options.method, options.idempotencyKey);

      if (!API_BASE_URL) {
        throw new Error(
          "NEXT_PUBLIC_API_BASE_URL is not configured. See CONTRIBUTING.md for required env vars."
        );
      }
      const isPreTenantOnboarding = path === "/onboarding" || path.startsWith("/onboarding/");
      const isUnscopedRoute =
        isPreTenantOnboarding || (options.method === "GET" && path === "/workspaces");
      if (!orgId && !isUnscopedRoute) {
        throw new Error(
          "No active Clerk organization in context; refusing to send a tenant-scoped request."
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
          "X-Request-Id": requestId,
          ...((options.branchId ?? activeBranchId)
            ? { "X-Drezivo-Branch-Id": options.branchId ?? activeBranchId }
            : {}),
          ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        // No automatic retry here for ANY method, including GET: TanStack Query owns read
        // retries (lib/query-client.tsx); a non-idempotent write is never retried by this
        // client, only replayed deliberately by the caller reusing the same guard key.
      });

      const payload = await safeParseJson(response);
      const parsed = responseEnvelope.safeParse(payload);

      if (!response.ok) {
        if (parsed.success && !parsed.data.success) {
          throw toApiError(response.status, parsed.data);
        }
        throw new ApiError(
          response.status,
          "unknown_error",
          "The request failed and returned no usable error body.",
          requestId
        );
      }

      if (!parsed.success) {
        // 2xx without a parseable envelope: the one shape the contract forbids. Surface it
        // as an error instead of returning an undefined `data` cast to TResponse.
        throw new ApiError(
          response.status,
          "unknown_error",
          "The request returned a malformed response.",
          requestId
        );
      }

      if (!parsed.data.success) {
        throw toApiError(response.status, parsed.data);
      }

      return parsed.data.data as TResponse;
    },
    [getToken, orgId, activeBranchId]
  );

  return {
    get: (path, signal) => request(path, { method: "GET", signal }),
    post: (path, body, idempotencyKey, signal) =>
      request(path, { method: "POST", body, idempotencyKey, signal }),
    patch: (path, body, idempotencyKey, signal) =>
      request(path, { method: "PATCH", body, idempotencyKey, signal }),
    del: (path, idempotencyKey, signal) =>
      request(path, { method: "DELETE", idempotencyKey, signal }),
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

function toApiError(status: number, envelope: FailureEnvelope): ApiError {
  return new ApiError(
    status,
    envelope.error.code,
    envelope.error.message,
    envelope.request_id,
    envelope.error.fields
  );
}
