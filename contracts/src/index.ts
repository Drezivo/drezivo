/**
 * @drezivo/contracts — the single source of truth for the Drezivo HTTP API
 * contract shared by `api`, `app`, and `web`. See README.md for what this
 * package is and the workspace release/migration rules.
 */
import { version } from '../package.json';

export * from './common';
export * from './catalogue';
export * from './storefront';
export * from './availability';
export * from './reservations';
export * from './fittings';
export * from './customers';
export * from './operations';
export * from './finance';
export * from './files';
export * from './tenancy';
export * from './guest';
export * from './operator';
export * from './dashboard';

/**
 * The exact `@drezivo/contracts` version this build was compiled against.
 * A consumer logs this at startup so a support investigation can answer
 * "which contract shape was `api`/`app`/`web` actually running?" without
 * needing to inspect `package-lock.json`.
 */
export const contractVersion: string = version;
