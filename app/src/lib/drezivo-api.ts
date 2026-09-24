"use client";

import {
  abandonOwnerOnboardingRequest,
  actorContext,
  apiEnvelope,
  bootstrapTenantRequest,
  catalogueCategory,
  catalogueCategoryList,
  createCatalogueCategoryRequest,
  createClothingVariantRequest,
  createClothingVariantResponse,
  clothingDetail,
  clothingListQuery,
  clothingListResponse,
  archiveClothingRequest,
  archiveClothingResponse,
  createClothingRequest,
  publishClothingRequest,
  publishClothingResponse,
  removeClothingVariantRequest,
  restoreClothingRequest,
  restoreClothingResponse,
  reservationCancelRequest,
  reservationCancelResponse,
  reservationCompleteRequest,
  reservationCompleteResponse,
  reservationDetail,
  reservationInspectionRequest,
  reservationInspectionResponse,
  reservationListQuery,
  reservationListResponse,
  reservationPickupRequest,
  reservationPickupResponse,
  reservationRejectRequest,
  reservationRejectResponse,
  reservationReturnRequest,
  reservationReturnResponse,
  staffReservationCompleteRequest,
  staffReservationCompleteResponse,
  staffReservationCreateRequest,
  staffReservationCreateResponse,
  staffReservationIntakeQuery,
  staffReservationIntakeResponse,
  updateClothingVariantLifecycleRequest,
  updateClothingVariantLifecycleResponse,
  createClothingResponse,
  removeCatalogueCategoryResponse,
  measurementGuide,
  measurementGuideDefaultResponse,
  replaceClothingImagesRequest,
  replaceClothingImagesResponse,
  saveMeasurementGuideRequest,
  uploadAuthorizationRequest,
  uploadAuthorizationResponse,
  uploadFinalizeResponse,
  chooseOnboardingPlanRequest,
  createOwnerOnboardingRequest,
  onboardingActorContext,
  organizationOnboarding,
  tenantBootstrapResponse,
  updateCatalogueCategoryRequest,
  updateCatalogueCategoryStatusRequest,
  updateClothingProductRequest,
  updateClothingProductResponse,
  updateClothingVariantRequest,
  updateClothingVariantResponse,
  updatePhysicalAssetStateRequest,
  updatePhysicalAssetStateResponse,
  workspaceList,
  type AbandonOwnerOnboardingRequest,
  type ActorContext,
  type BootstrapTenantRequest,
  type ChooseOnboardingPlanRequest,
  type CatalogueCategory,
  type CatalogueCategoryList,
  type CreateCatalogueCategoryRequest,
  type CreateClothingVariantRequest,
  type CreateClothingVariantResponse,
  type ClothingDetail,
  type ClothingListQuery,
  type ClothingListResponse,
  type ArchiveClothingRequest,
  type ArchiveClothingResponse,
  type CreateClothingRequest,
  type PublishClothingRequest,
  type PublishClothingResponse,
  type RemoveClothingVariantRequest,
  type RestoreClothingRequest,
  type RestoreClothingResponse,
  type ReservationCancelRequest,
  type ReservationCancelResponse,
  type ReservationCompleteRequest,
  type ReservationCompleteResponse,
  type ReservationDetail,
  type ReservationInspectionRequest,
  type ReservationInspectionResponse,
  type ReservationListQuery,
  type ReservationListResponse,
  type ReservationPickupRequest,
  type ReservationPickupResponse,
  type ReservationRejectRequest,
  type ReservationRejectResponse,
  type ReservationReturnRequest,
  type ReservationReturnResponse,
  type StaffReservationCompleteRequest,
  type StaffReservationCompleteResponse,
  type StaffReservationCreateRequest,
  type StaffReservationCreateResponse,
  type StaffReservationIntakeQuery,
  type StaffReservationIntakeResponse,
  type UpdateClothingVariantLifecycleRequest,
  type UpdateClothingVariantLifecycleResponse,
  type CreateClothingResponse,
  type RemoveCatalogueCategoryResponse,
  type MeasurementGuide,
  type MeasurementGuideDefaultResponse,
  type ReplaceClothingImagesRequest,
  type ReplaceClothingImagesResponse,
  type SaveMeasurementGuideRequest,
  type UploadAuthorizationRequest,
  type UploadAuthorizationResponse,
  type UploadFinalizeResponse,
  type CreateOwnerOnboardingRequest,
  type OnboardingActorContext,
  type OrganizationOnboarding,
  type TenantBootstrapResponse,
  type UpdateCatalogueCategoryRequest,
  type UpdateCatalogueCategoryStatusRequest,
  type UpdateClothingProductRequest,
  type UpdateClothingProductResponse,
  type UpdateClothingVariantRequest,
  type UpdateClothingVariantResponse,
  type UpdatePhysicalAssetStateRequest,
  type UpdatePhysicalAssetStateResponse,
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
    getReservations: (input: ReservationListQuery) => {
      const query = reservationListQuery.parse(input);
      const searchParams = new URLSearchParams();
      if (query.cursor) searchParams.set("cursor", query.cursor);
      searchParams.set("limit", String(query.limit));
      if (query.search) searchParams.set("search", query.search);
      if (query.status) searchParams.set("status", query.status);
      if (query.pickup_start) searchParams.set("pickup_start", query.pickup_start);
      if (query.pickup_end) searchParams.set("pickup_end", query.pickup_end);
      searchParams.set("sort", query.sort);

      return request<ReservationListResponse>({
        getToken,
        method: "GET",
        path: `/api/v1/reservations?${searchParams.toString()}`,
        responseSchema: apiEnvelope(reservationListResponse),
      });
    },
    getReservationDetail: (reservationId: string) =>
      request<ReservationDetail>({
        getToken,
        method: "GET",
        path: `/api/v1/reservations/${encodeURIComponent(reservationId)}`,
        responseSchema: apiEnvelope(reservationDetail),
      }),
    getStaffReservationIntakeOptions: (input: StaffReservationIntakeQuery) => {
      const query = staffReservationIntakeQuery.parse(input);
      const searchParams = new URLSearchParams();
      if (query.customer_search) searchParams.set("customer_search", query.customer_search);
      const suffix = searchParams.toString();
      return request<StaffReservationIntakeResponse>({
        getToken,
        method: "GET",
        path: `/api/v1/reservations/intake-options${suffix ? `?${suffix}` : ""}`,
        responseSchema: apiEnvelope(staffReservationIntakeResponse),
      });
    },
    createStaffReservation: (
      input: StaffReservationCreateRequest,
      idempotencyKey: string
    ) =>
      request<StaffReservationCreateResponse>({
        getToken,
        body: staffReservationCreateRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: "/api/v1/reservations",
        responseSchema: apiEnvelope(staffReservationCreateResponse),
      }),
    completeStaffReservation: (
      reservationId: string,
      input: StaffReservationCompleteRequest,
      idempotencyKey: string
    ) =>
      request<StaffReservationCompleteResponse>({
        getToken,
        body: staffReservationCompleteRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/reservations/${encodeURIComponent(reservationId)}/complete-booking`,
        responseSchema: apiEnvelope(staffReservationCompleteResponse),
      }),
    cancelReservation: (
      reservationId: string,
      input: ReservationCancelRequest,
      idempotencyKey: string
    ) =>
      request<ReservationCancelResponse>({
        getToken,
        body: reservationCancelRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/reservations/${encodeURIComponent(reservationId)}/cancel`,
        responseSchema: apiEnvelope(reservationCancelResponse),
      }),
    pickupReservation: (
      reservationId: string,
      input: ReservationPickupRequest,
      idempotencyKey: string
    ) =>
      request<ReservationPickupResponse>({
        getToken,
        body: reservationPickupRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/reservations/${encodeURIComponent(reservationId)}/pickup`,
        responseSchema: apiEnvelope(reservationPickupResponse),
      }),
    returnReservation: (
      reservationId: string,
      input: ReservationReturnRequest,
      idempotencyKey: string
    ) =>
      request<ReservationReturnResponse>({
        getToken,
        body: reservationReturnRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/reservations/${encodeURIComponent(reservationId)}/return`,
        responseSchema: apiEnvelope(reservationReturnResponse),
      }),
    inspectReservationReturn: (
      reservationId: string,
      input: ReservationInspectionRequest,
      idempotencyKey: string
    ) =>
      request<ReservationInspectionResponse>({
        getToken,
        body: reservationInspectionRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/reservations/${encodeURIComponent(reservationId)}/inspection`,
        responseSchema: apiEnvelope(reservationInspectionResponse),
      }),
    completeRentalReservation: (
      reservationId: string,
      input: ReservationCompleteRequest,
      idempotencyKey: string
    ) =>
      request<ReservationCompleteResponse>({
        getToken,
        body: reservationCompleteRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/reservations/${encodeURIComponent(reservationId)}/complete-rental`,
        responseSchema: apiEnvelope(reservationCompleteResponse),
      }),
    rejectReservation: (
      reservationId: string,
      input: ReservationRejectRequest,
      idempotencyKey: string
    ) =>
      request<ReservationRejectResponse>({
        getToken,
        body: reservationRejectRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/reservations/${encodeURIComponent(reservationId)}/reject`,
        responseSchema: apiEnvelope(reservationRejectResponse),
      }),
    getCatalogueCategories: () =>
      request<CatalogueCategoryList>({
        getToken,
        method: "GET",
        path: "/api/v1/catalogue/categories",
        responseSchema: apiEnvelope(catalogueCategoryList),
      }),
    createCatalogueCategory: (input: CreateCatalogueCategoryRequest, idempotencyKey: string) =>
      request<CatalogueCategory>({
        getToken,
        body: createCatalogueCategoryRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: "/api/v1/catalogue/categories",
        responseSchema: apiEnvelope(catalogueCategory),
      }),
    updateCatalogueCategory: (
      categoryId: string,
      input: UpdateCatalogueCategoryRequest,
      idempotencyKey: string
    ) =>
      request<CatalogueCategory>({
        getToken,
        body: updateCatalogueCategoryRequest.parse(input),
        idempotencyKey,
        method: "PATCH",
        path: `/api/v1/catalogue/categories/${encodeURIComponent(categoryId)}`,
        responseSchema: apiEnvelope(catalogueCategory),
      }),
    removeCatalogueCategory: (categoryId: string, idempotencyKey: string) =>
      request<RemoveCatalogueCategoryResponse>({
        getToken,
        idempotencyKey,
        method: "DELETE",
        path: `/api/v1/catalogue/categories/${encodeURIComponent(categoryId)}`,
        responseSchema: apiEnvelope(removeCatalogueCategoryResponse),
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
    saveMeasurementGuide: (input: SaveMeasurementGuideRequest, idempotencyKey: string) =>
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
    updateClothingProduct: (
      productId: string,
      input: UpdateClothingProductRequest,
      idempotencyKey: string
    ) =>
      request<UpdateClothingProductResponse>({
        getToken,
        body: updateClothingProductRequest.parse(input),
        idempotencyKey,
        method: "PATCH",
        path: `/api/v1/catalogue/clothing/${encodeURIComponent(productId)}`,
        responseSchema: apiEnvelope(updateClothingProductResponse),
      }),
    updateClothingVariant: (
      productId: string,
      variantId: string,
      input: UpdateClothingVariantRequest,
      idempotencyKey: string
    ) =>
      request<UpdateClothingVariantResponse>({
        getToken,
        body: updateClothingVariantRequest.parse(input),
        idempotencyKey,
        method: "PATCH",
        path: `/api/v1/catalogue/clothing/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
        responseSchema: apiEnvelope(updateClothingVariantResponse),
      }),
    replaceClothingImages: (
      productId: string,
      input: ReplaceClothingImagesRequest,
      idempotencyKey: string
    ) =>
      request<ReplaceClothingImagesResponse>({
        getToken,
        body: replaceClothingImagesRequest.parse(input),
        idempotencyKey,
        method: "PUT",
        path: `/api/v1/catalogue/clothing/${encodeURIComponent(productId)}/images`,
        responseSchema: apiEnvelope(replaceClothingImagesResponse),
      }),
    archiveClothing: (productId: string, input: ArchiveClothingRequest, idempotencyKey: string) =>
      request<ArchiveClothingResponse>({
        getToken,
        body: archiveClothingRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/catalogue/clothing/${encodeURIComponent(productId)}/archive`,
        responseSchema: apiEnvelope(archiveClothingResponse),
      }),
    publishClothing: (productId: string, input: PublishClothingRequest, idempotencyKey: string) =>
      request<PublishClothingResponse>({
        getToken,
        body: publishClothingRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/catalogue/clothing/${encodeURIComponent(productId)}/publish`,
        responseSchema: apiEnvelope(publishClothingResponse),
      }),
    restoreClothing: (productId: string, input: RestoreClothingRequest, idempotencyKey: string) =>
      request<RestoreClothingResponse>({
        getToken,
        body: restoreClothingRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/catalogue/clothing/${encodeURIComponent(productId)}/restore`,
        responseSchema: apiEnvelope(restoreClothingResponse),
      }),
    createClothingVariant: (
      productId: string,
      input: CreateClothingVariantRequest,
      idempotencyKey: string
    ) =>
      request<CreateClothingVariantResponse>({
        getToken,
        body: createClothingVariantRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/catalogue/clothing/${encodeURIComponent(productId)}/variants`,
        responseSchema: apiEnvelope(createClothingVariantResponse),
      }),
    updateClothingVariantLifecycle: (
      productId: string,
      variantId: string,
      input: UpdateClothingVariantLifecycleRequest,
      idempotencyKey: string
    ) =>
      request<UpdateClothingVariantLifecycleResponse>({
        getToken,
        body: updateClothingVariantLifecycleRequest.parse(input),
        idempotencyKey,
        method: "PATCH",
        path: `/api/v1/catalogue/clothing/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/lifecycle`,
        responseSchema: apiEnvelope(updateClothingVariantLifecycleResponse),
      }),
    removeClothingVariant: (
      productId: string,
      variantId: string,
      input: RemoveClothingVariantRequest,
      idempotencyKey: string
    ) =>
      request<UpdateClothingVariantLifecycleResponse>({
        getToken,
        body: removeClothingVariantRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/catalogue/clothing/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/remove`,
        responseSchema: apiEnvelope(updateClothingVariantLifecycleResponse),
      }),
    updatePhysicalAssetState: (
      assetId: string,
      input: UpdatePhysicalAssetStateRequest,
      idempotencyKey: string
    ) =>
      request<UpdatePhysicalAssetStateResponse>({
        getToken,
        body: updatePhysicalAssetStateRequest.parse(input),
        idempotencyKey,
        method: "PATCH",
        path: `/api/v1/catalogue/assets/${encodeURIComponent(assetId)}/state`,
        responseSchema: apiEnvelope(updatePhysicalAssetStateResponse),
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
      if (query.availability_start)
        searchParams.set("availability_start", query.availability_start);
      if (query.availability_end) searchParams.set("availability_end", query.availability_end);
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
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
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
