/**
 * Static storefront phase.
 *
 * Guest reservation state is encoded locally for UI/flow visualization, so this
 * module intentionally performs no capability exchange, cookie authentication,
 * or backend request. Restore the production capability implementation when the
 * storefront is ready to reconnect to the Express API.
 */
export * from './static-capability';
