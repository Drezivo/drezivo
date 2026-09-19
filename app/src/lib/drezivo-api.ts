"use client";

import {
  apiEnvelope,
  createOwnerOnboardingRequest,
  onboardingActorContext,
  organizationOnboarding,
  type CreateOwnerOnboardingRequest,
  type OnboardingActorContext,
  type OrganizationOnboarding,
} from "@drezivo/contracts";

type TokenGetter = () => Promise<string | null>;

type ApiResult<T> = {
  data: T;
  requestId: string;
};

export class DrezivoApiError extends Error {
  readonly code: string;
  readonly requestId: string | null;
  readonly status: number;

  constructor(
    message: string,
    options: { code?: string; requestId?: string | null; status: number }
  ) {
    super(message);
    this.name = "DrezivoApiError";
    this.code = options.code ?? "INTERNAL_ERROR";
    this.requestId = options.requestId ?? null;
    this.status = options.status;
  }
}

export function createDrezivoApiClient(getToken: TokenGetter) {
  return {
    getCurrentOnboarding: () =>
      request<OnboardingActorContext>({
        getToken,
        method: "GET",
        path: "/api/v1/onboarding/current",
        responseSchema: apiEnvelope(onboardingActorContext),
      }),
    createOnboarding: (input: CreateOwnerOnboardingRequest, idempotencyKey: string) =>
      request<OrganizationOnboarding>({
        getToken,
        body: createOwnerOnboardingRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: "/api/v1/onboarding",
        responseSchema: apiEnvelope(organizationOnboarding),
      }),
  };
}

async function request<T>({
  body,
  getToken,
  idempotencyKey,
  method,
  path,
  responseSchema,
}: {
  body?: unknown;
  getToken: TokenGetter;
  idempotencyKey?: string;
  method: "GET" | "POST";
  path: string;
  responseSchema: ReturnType<typeof apiEnvelope>;
}): Promise<ApiResult<T>> {
  const token = await getToken();
  if (!token) {
    throw new DrezivoApiError("Your session has expired. Please sign in again.", { status: 401 });
  }

  const apiOrigin = process.env["NEXT_PUBLIC_API_ORIGIN"]?.replace(/\/$/, "");
  if (!apiOrigin) {
    throw new DrezivoApiError("The Drezivo API is not configured for this environment.", {
      status: 503,
    });
  }

  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);

  let response: Response;
  try {
    const requestInit: RequestInit = { cache: "no-store", headers, method };
    if (body !== undefined) requestInit.body = JSON.stringify(body);
    response = await fetch(`${apiOrigin}${path}`, requestInit);
  } catch {
    throw new DrezivoApiError("We could not reach Drezivo. Check your connection and try again.", {
      status: 503,
    });
  }

  const payload: unknown = await response.json().catch(() => null);
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new DrezivoApiError("Drezivo returned an invalid response. Please try again.", {
      status: response.status,
    });
  }

  if (!parsed.data.success) {
    throw new DrezivoApiError(parsed.data.error.message, {
      code: parsed.data.error.code,
      requestId: parsed.data.request_id,
      status: response.status,
    });
  }

  return {
    data: parsed.data.data as T,
    requestId: parsed.data.request_id,
  };
}
