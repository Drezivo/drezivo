/**
 * Switches for the pilot, when Drezivo runs without a separate background worker service.
 * Each one is reversible: flip it back when the dedicated worker returns
 * (see docs/runbooks/pilot-operation.md).
 */

/**
 * Owner email toggles are hidden: during the pilot every customer email (booking received,
 * approved, rejected, cancelled) always sends, and owner alerts go to the business email. The API
 * ignores saved toggles while its NOTIFICATION_PREFERENCES_ENFORCED is false.
 */
export const SHOW_NOTIFICATION_SETTINGS = false;
