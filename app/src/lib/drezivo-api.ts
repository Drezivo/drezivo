"use client";

import {
  abandonOwnerOnboardingRequest,
  actorContext,
  apiEnvelope,
  bootstrapTenantRequest,
  catalogueCategory,
  catalogueCategoryList,
  clothingDetail,
  clothingListQuery,
  clothingListResponse,
  createClothingRequest,
  createClothingResponse,
  measurementGuide,
  measurementGuideDefaultResponse,
  saveMeasurementGuideRequest,
  uploadAuthorizationRequest,
  uploadAuthorizationResponse,
  uploadFinalizeResponse,
  chooseOnboardingPlanRequest,
  createOwnerOnboardingRequest,
  onboardingActorContext,
  organizationOnboarding,
  tenantBootstrapResponse,
  updateCatalogueCategoryStatusRequest,
  workspaceList,
  type AbandonOwnerOnboardingRequest,
  type ActorContext,
  type BootstrapTenantRequest,
  type ChooseOnboardingPlanRequest,
  type CatalogueCategory,
  type CatalogueCategoryList,
  type ClothingDetail,
  type ClothingListQuery,
  type ClothingListResponse,
  type CreateClothingRequest,
  type CreateClothingResponse,
  type MeasurementGuide,
  type MeasurementGuideDefaultResponse,
  type SaveMeasurementGuideRequest,
  type UploadAuthorizationRequest,
  type UploadAuthorizationResponse,
  type UploadFinalizeResponse,
  type CreateOwnerOnboardingRequest,
  type OnboardingActorContext,
  type OrganizationOnboarding,
  type TenantBootstrapResponse,
  type UpdateCatalogueCategoryStatusRequest,
  type WorkspaceList,
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
    selectOnboardingPlan: (
      onboardingId: string,
      input: ChooseOnboardingPlanRequest,
      idempotencyKey: string
    ) =>
      request<OrganizationOnboarding>({
        getToken,
        body: chooseOnboardingPlanRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/onboarding/${encodeURIComponent(onboardingId)}/plan`,
        responseSchema: apiEnvelope(organizationOnboarding),
      }),
    abandonOnboarding: (
      onboardingId: string,
      input: AbandonOwnerOnboardingRequest,
      idempotencyKey: string
    ) =>
      request<OrganizationOnboarding>({
        getToken,
        body: abandonOwnerOnboardingRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/onboarding/${encodeURIComponent(onboardingId)}/abandon`,
        responseSchema: apiEnvelope(organizationOnboarding),
      }),
    bootstrapOnboarding: (
      onboardingId: string,
      input: BootstrapTenantRequest,
      idempotencyKey: string
    ) =>
      request<TenantBootstrapResponse>({
        getToken,
        body: bootstrapTenantRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/onboarding/${encodeURIComponent(onboardingId)}/bootstrap`,
        responseSchema: apiEnvelope(tenantBootstrapResponse),
      }),
    getWorkspaces: () =>
      request<WorkspaceList>({
        getToken,
        method: "GET",
        path: "/api/v1/workspaces",
        responseSchema: apiEnvelope(workspaceList),
      }),
    getActorContext: () =>
      request<ActorContext>({
        getToken,
        method: "GET",
        path: "/api/v1/actor-context",
        responseSchema: apiEnvelope(actorContext),
      }),
    getCatalogueCategories: () =>
      request<CatalogueCategoryList>({
        getToken,
        method: "GET",
        path: "/api/v1/catalogue/categories",
        responseSchema: apiEnvelope(catalogueCategoryList),
      }),
    getCatalogueClothingDetail: (productId: string) =>
      request<ClothingDetail>({
        getToken,
        method: "GET",
        path: `/api/v1/catalogue/clothing/${encodeURIComponent(productId)}`,
        responseSchema: apiEnvelope(clothingDetail),
      }),
    getDefaultMeasurementGuide: () =>
      request<MeasurementGuideDefaultResponse>({
        getToken,
        method: "GET",
        path: "/api/v1/catalogue/measurement-guide/default",
        responseSchema: apiEnvelope(measurementGuideDefaultResponse),
      }),
    saveMeasurementGuide: (
      input: SaveMeasurementGuideRequest,
      idempotencyKey: string
    ) =>
      request<MeasurementGuide>({
        getToken,
        body: saveMeasurementGuideRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: "/api/v1/catalogue/measurement-guides",
        responseSchema: apiEnvelope(measurementGuide),
      }),
    authorizeUpload: (input: UploadAuthorizationRequest, idempotencyKey: string) =>
      request<UploadAuthorizationResponse>({
        getToken,
        body: uploadAuthorizationRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: "/api/v1/uploads",
        responseSchema: apiEnvelope(uploadAuthorizationResponse),
      }),
    finalizeUpload: (fileId: string, idempotencyKey: string) =>
      request<UploadFinalizeResponse>({
        getToken,
        body: {},
        idempotencyKey,
        method: "POST",
        path: `/api/v1/uploads/${encodeURIComponent(fileId)}/finalize`,
        responseSchema: apiEnvelope(uploadFinalizeResponse),
      }),
    createClothing: (input: CreateClothingRequest, idempotencyKey: string) =>
      request<CreateClothingResponse>({
        getToken,
        body: createClothingRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: "/api/v1/catalogue/clothing",
        responseSchema: apiEnvelope(createClothingResponse),
      }),
    getCatalogueClothing: (input: ClothingListQuery) => {
      const query = clothingListQuery.parse(input);
      const searchParams = new URLSearchParams();
      if (query.cursor) searchParams.set("cursor", query.cursor);
      searchParams.set("limit", String(query.limit));
      if (query.search) searchParams.set("search", query.search);
      if (query.category_id) searchParams.set("category_id", query.category_id);
      if (query.size_label) searchParams.set("size_label", query.size_label);
      if (query.product_status) searchParams.set("product_status", query.product_status);
      if (query.asset_lifecycle) searchParams.set("asset_lifecycle", query.asset_lifecycle);
      if (query.readiness) searchParams.set("readiness", query.readiness);
      searchParams.set("sort", query.sort);

      return request<ClothingListResponse>({
        getToken,
        method: "GET",
        path: `/api/v1/catalogue/clothing?${searchParams.toString()}`,
        responseSchema: apiEnvelope(clothingListResponse),
      });
    },
    updateCatalogueCategoryStatus: (
      categoryId: string,
      input: UpdateCatalogueCategoryStatusRequest,
      idempotencyKey: string
    ) =>
      request<CatalogueCategory>({
        getToken,
        body: updateCatalogueCategoryStatusRequest.parse(input),
        idempotencyKey,
        method: "PATCH",
        path: `/api/v1/catalogue/categories/${encodeURIComponent(categoryId)}/status`,
        responseSchema: apiEnvelope(catalogueCategory),
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
  method: "GET" | "PATCH" | "POST" | "PUT";
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
