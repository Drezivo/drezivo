/**
 * Barrel export consumed by drizzle-kit (see drizzle.config.ts) and by db/client.ts to build
 * the typed drizzle instance. One file per domain module, mirroring TRD §2's module list —
 * see each file's header comment for what it owns and which TRD/Data-Model sections govern
 * it.
 */
export * from './tenancy.js';
export * from './account.js';
export * from './onboarding.js';
export * from './catalogue.js';
export * from './files.js';
export * from './storefront.js';
export * from './availability.js';
export * from './reservations.js';
export * from './finance.js';
export * from './billing.js';
export * from './jobs.js';
export * from './audit.js';
export * from './bootstrap.js';
