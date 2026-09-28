/** Staff-facing customer lifecycle and activity vocabulary. */
import { z } from 'zod';

/** Operational profile state. Privacy anonymization remains a separate lifecycle. */
export const customerProfileStatus = z.enum(['active', 'archived']);
export type CustomerProfileStatus = z.infer<typeof customerProfileStatus>;

/** Directory status filter; active is the default at the list-query boundary. */
export const customerListStatus = z.enum(['active', 'archived', 'all']);
export type CustomerListStatus = z.infer<typeof customerListStatus>;

/** Authoritative module that produced a customer activity marker. */
export const customerActivityKind = z.enum(['reservation', 'fitting']);
export type CustomerActivityKind = z.infer<typeof customerActivityKind>;
