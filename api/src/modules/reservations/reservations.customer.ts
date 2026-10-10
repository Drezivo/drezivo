import type { PoolClient } from 'pg';

import type {
  ReservationCancellationCustomerInput,
  StaffReservationCustomerInput,
} from '@drezivo/contracts';

import { NotFoundError, StateConflictError, ValidationError } from '../../shared/errors.js';
import {
  createReservationCustomer,
  fillReservationCustomerAddress,
  readReservationCustomerForCreate,
  type ReservationCustomerSnapshotRow,
} from './reservations.command.repository.js';

/** Resolve a reservation customer inside the caller's transaction, so profile and reservation
 * changes either commit together or roll back together. */
export async function resolveReservationCustomer(
  client: PoolClient,
  tenantId: string,
  input: StaffReservationCustomerInput,
): Promise<ReservationCustomerSnapshotRow> {
  if (input.source === 'new') {
    return createReservationCustomer(client, {
      tenantId,
      fullName: input.customer.full_name,
      phone: input.customer.phone ?? null,
      email: input.customer.email?.trim().toLowerCase() ?? null,
      address: input.customer.address,
      socialMedia: input.customer.social_media ?? null,
      notes: input.customer.notes ?? null,
    });
  }

  const existing = await readReservationCustomerForCreate(client, {
    tenantId,
    customerId: input.customer_id,
  });
  if (!existing) throw new NotFoundError('Customer could not be found.');
  if (existing.address !== null) {
    if (input.address !== undefined) {
      throw new ValidationError('Customer already has an address. Update it through customer management.');
    }
    return existing;
  }
  if (input.address === undefined) {
    throw new ValidationError('Customer address is required before creating a reservation.');
  }
  const address = await fillReservationCustomerAddress(client, {
    tenantId,
    customerId: existing.id,
    address: input.address,
  });
  if (!address) throw new StateConflictError('Customer address changed during reservation creation.');
  return { ...existing, address };
}

/** Cancellation can preserve a useful name/contact profile before fulfillment details exist.
 * Existing profiles are only linked; this path never edits their saved fields. */
export async function resolveReservationCancellationCustomer(
  client: PoolClient,
  tenantId: string,
  input: ReservationCancellationCustomerInput,
): Promise<ReservationCustomerSnapshotRow> {
  if (input.source === 'existing') {
    const existing = await readReservationCustomerForCreate(client, {
      tenantId,
      customerId: input.customer_id,
    });
    if (!existing) throw new NotFoundError('Customer could not be found.');
    return existing;
  }

  return createReservationCustomer(client, {
    tenantId,
    fullName: input.customer.full_name,
    phone: input.customer.phone ?? null,
    email: input.customer.email?.trim().toLowerCase() ?? null,
    address: input.customer.address ?? null,
    socialMedia: input.customer.social_media ?? null,
    notes: input.customer.notes ?? null,
  });
}
