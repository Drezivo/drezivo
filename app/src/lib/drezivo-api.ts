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
  changeClothingSizingModeRequest,
  changeClothingSizingModeResponse,
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
  reservationConfirmRequest,
  reservationConfirmResponse,
  reservationPaymentReceiptAttachRequest,
  reservationPaymentReceiptAttachResponse,
  reservationPaymentVerifyRequest,
  reservationPaymentVerifyResponse,
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
  staffReservationAvailabilityCalendarQuery,
  staffReservationAvailabilityCalendarResponse,
  staffReservationAvailabilityCheckQuery,
  staffReservationAvailabilityCheckResponse,
  staffReservationCompleteRequest,
  staffReservationCompleteResponse,
  staffReservationCreateRequest,
  staffReservationCreateResponse,
  staffReservationIntakeQuery,
  staffReservationIntakeResponse,
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
  paymentMethodSettingsItem,
  paymentMethodSettingsList,
  tenantBootstrapResponse,
  updatePaymentMethodSettingsRequest,
  updateCatalogueCategoryRequest,
  updateCatalogueCategoryStatusRequest,
  updateClothingProductRequest,
  updateClothingProductResponse,
  updateClothingVariantRequest,
  updateClothingVariantResponse,
  updatePhysicalAssetStateRequest,
  updatePhysicalAssetStateResponse,
  workspaceList,
  clothingAvailabilityTimelineQuery,
  clothingAvailabilityTimelineResponse,
  dashboardFittingSummaryResponse,
  fittingActionResponse,
  fittingCancelRequest,
  fittingCompleteRequest,
  fittingConfirmRequest,
  fittingCreateRequest,
  fittingCreateResponse,
  fittingDetail,
  fittingIntakeQuery,
  fittingIntakeResponse,
  fittingListQuery,
  fittingListResponse,
  fittingNoShowRequest,
  fittingRejectRequest,
  fittingRescheduleRequest,
  fittingClosureCreateRequest,
  fittingClosureListQuery,
  fittingClosureListResponse,
  fittingClosureMutationResponse,
  fittingClosureRemoveRequest,
  fittingClosureRemoveResponse,
  fittingClosureUpdateRequest,
  fittingSettings,
  fittingSettingsUpdateRequest,
  fittingSettingsUpdateResponse,
  fittingWeeklyHoursUpdateRequest,
  fittingWeeklyHoursUpdateResponse,
  customerListQuery,
  customerListResponse,
  customerArchiveRequest,
  customerArchiveResponse,
  customerDetailResponse,
  customerSummaryResponse,
  type AbandonOwnerOnboardingRequest,
  type ActorContext,
  type BootstrapTenantRequest,
  type ChooseOnboardingPlanRequest,
  type CatalogueCategory,
  type CatalogueCategoryList,
  type CreateCatalogueCategoryRequest,
  type CreateClothingVariantRequest,
  type CreateClothingVariantResponse,
  type ChangeClothingSizingModeRequest,
  type ChangeClothingSizingModeResponse,
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
  type ReservationConfirmRequest,
  type ReservationConfirmResponse,
  type ReservationPaymentReceiptAttachRequest,
  type ReservationPaymentReceiptAttachResponse,
  type ReservationPaymentVerifyRequest,
  type ReservationPaymentVerifyResponse,
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
  type StaffReservationAvailabilityCalendarQuery,
  type StaffReservationAvailabilityCalendarResponse,
  type StaffReservationAvailabilityCheckQuery,
  type StaffReservationAvailabilityCheckResponse,
  type StaffReservationCompleteRequest,
  type StaffReservationCompleteResponse,
  type StaffReservationCreateRequest,
  type StaffReservationCreateResponse,
  type StaffReservationIntakeQuery,
  type StaffReservationIntakeResponse,
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
  type PaymentMethodSettingsItem,
  type PaymentMethodSettingsList,
  type TenantBootstrapResponse,
  type UpdatePaymentMethodSettingsRequest,
  type UpdateCatalogueCategoryRequest,
  type UpdateCatalogueCategoryStatusRequest,
  type UpdateClothingProductRequest,
  type UpdateClothingProductResponse,
  type UpdateClothingVariantRequest,
  type UpdateClothingVariantResponse,
  type UpdatePhysicalAssetStateRequest,
  type UpdatePhysicalAssetStateResponse,
  type WorkspaceList,
  type ClothingAvailabilityTimelineQuery,
  type ClothingAvailabilityTimelineResponse,
  type DashboardFittingSummaryResponse,
  type FittingActionResponse,
  type FittingCancelRequest,
  type FittingCompleteRequest,
  type FittingConfirmRequest,
  type FittingCreateRequest,
  type FittingCreateResponse,
  type FittingDetail,
  type FittingIntakeQuery,
  type FittingIntakeResponse,
  type FittingListQuery,
  type FittingListResponse,
  type FittingNoShowRequest,
  type FittingRejectRequest,
  type FittingRescheduleRequest,
  type FittingClosureCreateRequest,
  type FittingClosureListQuery,
  type FittingClosureListResponse,
  type FittingClosureMutationResponse,
  type FittingClosureRemoveRequest,
  type FittingClosureRemoveResponse,
  type FittingClosureUpdateRequest,
  type FittingSettings,
  type FittingSettingsUpdateRequest,
  type FittingSettingsUpdateResponse,
  type FittingWeeklyHoursUpdateRequest,
  type FittingWeeklyHoursUpdateResponse,
  type CustomerListQuery,
  type CustomerListResponse,
  type CustomerArchiveRequest,
  type CustomerArchiveResponse,
  type CustomerDetailResponse,
  type CustomerSummaryResponse,
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
    getCustomers: (input: CustomerListQuery) => {
      const query = customerListQuery.parse(input);
      const searchParams = new URLSearchParams({
        limit: String(query.limit),
        status: query.status,
      });
      if (query.cursor) searchParams.set("cursor", query.cursor);
      if (query.search) searchParams.set("search", query.search);

      return request<CustomerListResponse>({
        getToken,
        method: "GET",
        path: `/api/v1/customers?${searchParams.toString()}`,
        responseSchema: apiEnvelope(customerListResponse),
      });
    },
    getCustomerSummary: () =>
      request<CustomerSummaryResponse>({
        getToken,
        method: "GET",
        path: "/api/v1/customers/summary",
        responseSchema: apiEnvelope(customerSummaryResponse),
      }),
    getCustomerDetail: (customerId: string) =>
      request<CustomerDetailResponse>({
        getToken,
        method: "GET",
        path: `/api/v1/customers/${encodeURIComponent(customerId)}`,
        responseSchema: apiEnvelope(customerDetailResponse),
      }),
    archiveCustomer: (
      customerId: string,
      input: CustomerArchiveRequest,
      idempotencyKey: string
    ) =>
      request<CustomerArchiveResponse>({
        getToken,
        body: customerArchiveRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/customers/${encodeURIComponent(customerId)}/archive`,
        responseSchema: apiEnvelope(customerArchiveResponse),
      }),
    getPaymentMethodSettings: () =>
      request<PaymentMethodSettingsList>({
        getToken,
        method: "GET",
        path: "/api/v1/payment-methods",
        responseSchema: apiEnvelope(paymentMethodSettingsList),
      }),
    updatePaymentMethodSettings: (
      paymentMethodId: string,
      input: UpdatePaymentMethodSettingsRequest,
      idempotencyKey: string
    ) =>
      request<PaymentMethodSettingsItem>({
        getToken,
        body: updatePaymentMethodSettingsRequest.parse(input),
        idempotencyKey,
        method: "PATCH",
        path: `/api/v1/payment-methods/${encodeURIComponent(paymentMethodId)}`,
        responseSchema: apiEnvelope(paymentMethodSettingsItem),
      }),
    getFittings: (input: FittingListQuery) => {
      const query = fittingListQuery.parse(input);
      const searchParams = new URLSearchParams();
      if (query.cursor) searchParams.set("cursor", query.cursor);
      searchParams.set("limit", String(query.limit));
      if (query.search) searchParams.set("search", query.search);
      if (query.status) searchParams.set("status", query.status);
      if (query.period_start) searchParams.set("period_start", query.period_start);
      if (query.period_end) searchParams.set("period_end", query.period_end);
      searchParams.set("sort", query.sort);

      return request<FittingListResponse>({
        getToken,
        method: "GET",
        path: `/api/v1/fittings?${searchParams.toString()}`,
        responseSchema: apiEnvelope(fittingListResponse),
      });
    },
    getFittingDetail: (fittingId: string) =>
      request<FittingDetail>({
        getToken,
        method: "GET",
        path: `/api/v1/fittings/${encodeURIComponent(fittingId)}`,
        responseSchema: apiEnvelope(fittingDetail),
      }),
    getFittingIntakeOptions: (input: FittingIntakeQuery) => {
      const query = fittingIntakeQuery.parse(input);
      const searchParams = new URLSearchParams();
      if (query.customer_search) searchParams.set("customer_search", query.customer_search);
      const suffix = searchParams.toString();
      return request<FittingIntakeResponse>({
        getToken,
        method: "GET",
        path: `/api/v1/fittings/intake-options${suffix ? `?${suffix}` : ""}`,
        responseSchema: apiEnvelope(fittingIntakeResponse),
      });
    },
    getFittingSettings: () =>
      request<FittingSettings>({
        getToken,
        method: "GET",
        path: "/api/v1/fittings/settings",
        responseSchema: apiEnvelope(fittingSettings),
      }),
    updateFittingSettings: (input: FittingSettingsUpdateRequest, idempotencyKey: string) =>
      request<FittingSettingsUpdateResponse>({
        getToken,
        body: fittingSettingsUpdateRequest.parse(input),
        idempotencyKey,
        method: "PUT",
        path: "/api/v1/fittings/settings",
        responseSchema: apiEnvelope(fittingSettingsUpdateResponse),
      }),
    updateFittingWeeklyHours: (input: FittingWeeklyHoursUpdateRequest, idempotencyKey: string) =>
      request<FittingWeeklyHoursUpdateResponse>({
        getToken,
        body: fittingWeeklyHoursUpdateRequest.parse(input),
        idempotencyKey,
        method: "PUT",
        path: "/api/v1/fittings/settings/hours",
        responseSchema: apiEnvelope(fittingWeeklyHoursUpdateResponse),
      }),
    getFittingClosures: (input: FittingClosureListQuery) => {
      const query = fittingClosureListQuery.parse(input);
      const searchParams = new URLSearchParams({
        limit: String(query.limit),
        period_start: query.period_start,
        period_end: query.period_end,
      });
      if (query.cursor) searchParams.set("cursor", query.cursor);

      return request<FittingClosureListResponse>({
        getToken,
        method: "GET",
        path: `/api/v1/fittings/closures?${searchParams.toString()}`,
        responseSchema: apiEnvelope(fittingClosureListResponse),
      });
    },
    createFittingClosure: (input: FittingClosureCreateRequest, idempotencyKey: string) =>
      request<FittingClosureMutationResponse>({
        getToken,
        body: fittingClosureCreateRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: "/api/v1/fittings/closures",
        responseSchema: apiEnvelope(fittingClosureMutationResponse),
      }),
    updateFittingClosure: (
      closureId: string,
      input: FittingClosureUpdateRequest,
      idempotencyKey: string
    ) =>
      request<FittingClosureMutationResponse>({
        getToken,
        body: fittingClosureUpdateRequest.parse(input),
        idempotencyKey,
        method: "PUT",
        path: `/api/v1/fittings/closures/${encodeURIComponent(closureId)}`,
        responseSchema: apiEnvelope(fittingClosureMutationResponse),
      }),
    removeFittingClosure: (
      closureId: string,
      input: FittingClosureRemoveRequest,
      idempotencyKey: string
    ) =>
      request<FittingClosureRemoveResponse>({
        getToken,
        body: fittingClosureRemoveRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/fittings/closures/${encodeURIComponent(closureId)}/remove`,
        responseSchema: apiEnvelope(fittingClosureRemoveResponse),
      }),
    getFittingDashboardSummary: () =>
      request<DashboardFittingSummaryResponse>({
        getToken,
        method: "GET",
        path: "/api/v1/dashboard/fittings-summary",
        responseSchema: apiEnvelope(dashboardFittingSummaryResponse),
      }),
    getClothingAvailabilityTimeline: (input: ClothingAvailabilityTimelineQuery) => {
      const query = clothingAvailabilityTimelineQuery.parse(input);
      const searchParams = new URLSearchParams({
        start_date: query.start_date,
        end_date: query.end_date,
        limit: String(query.limit),
      });
      if (query.search) searchParams.set("search", query.search);
      if (query.category_id) searchParams.set("category_id", query.category_id);
      if (query.size_label) searchParams.set("size_label", query.size_label);
      if (query.status) searchParams.set("status", query.status);
      if (query.cursor) searchParams.set("cursor", query.cursor);

      return request<ClothingAvailabilityTimelineResponse>({
        getToken,
        method: "GET",
        path: `/api/v1/calendar/availability?${searchParams.toString()}`,
        responseSchema: apiEnvelope(clothingAvailabilityTimelineResponse),
      });
    },
    createFitting: (input: FittingCreateRequest, idempotencyKey: string) =>
      request<FittingCreateResponse>({
        getToken,
        body: fittingCreateRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: "/api/v1/fittings",
        responseSchema: apiEnvelope(fittingCreateResponse),
      }),
    confirmFitting: (fittingId: string, input: FittingConfirmRequest, idempotencyKey: string) =>
      request<FittingActionResponse>({
        getToken,
        body: fittingConfirmRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/fittings/${encodeURIComponent(fittingId)}/confirm`,
        responseSchema: apiEnvelope(fittingActionResponse),
      }),
    rejectFitting: (fittingId: string, input: FittingRejectRequest, idempotencyKey: string) =>
      request<FittingActionResponse>({
        getToken,
        body: fittingRejectRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/fittings/${encodeURIComponent(fittingId)}/reject`,
        responseSchema: apiEnvelope(fittingActionResponse),
      }),
    cancelFitting: (fittingId: string, input: FittingCancelRequest, idempotencyKey: string) =>
      request<FittingActionResponse>({
        getToken,
        body: fittingCancelRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/fittings/${encodeURIComponent(fittingId)}/cancel`,
        responseSchema: apiEnvelope(fittingActionResponse),
      }),
    completeFitting: (fittingId: string, input: FittingCompleteRequest, idempotencyKey: string) =>
      request<FittingActionResponse>({
        getToken,
        body: fittingCompleteRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/fittings/${encodeURIComponent(fittingId)}/complete`,
        responseSchema: apiEnvelope(fittingActionResponse),
      }),
    markFittingNoShow: (fittingId: string, input: FittingNoShowRequest, idempotencyKey: string) =>
      request<FittingActionResponse>({
        getToken,
        body: fittingNoShowRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/fittings/${encodeURIComponent(fittingId)}/no-show`,
        responseSchema: apiEnvelope(fittingActionResponse),
      }),
    rescheduleFitting: (
      fittingId: string,
      input: FittingRescheduleRequest,
      idempotencyKey: string
    ) =>
      request<FittingActionResponse>({
        getToken,
        body: fittingRescheduleRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/fittings/${encodeURIComponent(fittingId)}/reschedule`,
        responseSchema: apiEnvelope(fittingActionResponse),
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
    getStaffReservationAvailabilityCalendar: (input: StaffReservationAvailabilityCalendarQuery) => {
      const query = staffReservationAvailabilityCalendarQuery.parse(input);
      const searchParams = new URLSearchParams({
        variant_id: query.variant_id,
        start_date: query.start_date,
        end_date: query.end_date,
      });
      return request<StaffReservationAvailabilityCalendarResponse>({
        getToken,
        method: "GET",
        path: `/api/v1/reservations/availability-calendar?${searchParams.toString()}`,
        responseSchema: apiEnvelope(staffReservationAvailabilityCalendarResponse),
      });
    },
    getStaffReservationAvailabilityCheck: (input: StaffReservationAvailabilityCheckQuery) => {
      const query = staffReservationAvailabilityCheckQuery.parse(input);
      const searchParams = new URLSearchParams({
        variant_id: query.variant_id,
        pickup_at: query.pickup_at,
        due_at: query.due_at,
      });
      return request<StaffReservationAvailabilityCheckResponse>({
        getToken,
        method: "GET",
        path: `/api/v1/reservations/availability-check?${searchParams.toString()}`,
        responseSchema: apiEnvelope(staffReservationAvailabilityCheckResponse),
      });
    },
    createStaffReservation: (input: StaffReservationCreateRequest, idempotencyKey: string) =>
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
    attachReservationPaymentReceipt: (
      reservationId: string,
      input: ReservationPaymentReceiptAttachRequest,
      idempotencyKey: string
    ) =>
      request<ReservationPaymentReceiptAttachResponse>({
        getToken,
        body: reservationPaymentReceiptAttachRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/reservations/${encodeURIComponent(reservationId)}/payment-receipt`,
        responseSchema: apiEnvelope(reservationPaymentReceiptAttachResponse),
      }),
    verifyReservationPayment: (
      reservationId: string,
      input: ReservationPaymentVerifyRequest,
      idempotencyKey: string
    ) =>
      request<ReservationPaymentVerifyResponse>({
        getToken,
        body: reservationPaymentVerifyRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/reservations/${encodeURIComponent(reservationId)}/verify-payment`,
        responseSchema: apiEnvelope(reservationPaymentVerifyResponse),
      }),
    confirmReservation: (
      reservationId: string,
      input: ReservationConfirmRequest,
      idempotencyKey: string
    ) =>
      request<ReservationConfirmResponse>({
        getToken,
        body: reservationConfirmRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/reservations/${encodeURIComponent(reservationId)}/confirm`,
        responseSchema: apiEnvelope(reservationConfirmResponse),
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
    changeClothingSizingMode: (
      productId: string,
      input: ChangeClothingSizingModeRequest,
      idempotencyKey: string
    ) =>
      request<ChangeClothingSizingModeResponse>({
        getToken,
        body: changeClothingSizingModeRequest.parse(input),
        idempotencyKey,
        method: "POST",
        path: `/api/v1/catalogue/clothing/${encodeURIComponent(productId)}/sizing-mode`,
        responseSchema: apiEnvelope(changeClothingSizingModeResponse),
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
