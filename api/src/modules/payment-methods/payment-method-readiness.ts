/**
 * The ONE definition of "renters can pay with this online method", shared by the settings list,
 * the public storefront, checkout, and the storefront publish checklist so they can never disagree.
 *
 * A method is ready when it is active, enabled for the storefront, not cash, and either
 * - presents the business's own instructions file (`material`): an accepted file of purpose
 *   `payment_method_material` owned by the same tenant; or
 * - presents typed details: a QR method needs an accepted QR image, a transfer needs an account
 *   number.
 *
 * Callers must join `file_object` twice with the aliases they pass here:
 *   LEFT JOIN file_object <qr>  ON <qr>.tenant_id = <pm>.tenant_id AND <qr>.id = <pm>.qr_file_id
 *   LEFT JOIN file_object <mat> ON <mat>.tenant_id = <pm>.tenant_id AND <mat>.id = <pm>.material_file_id
 * Aliases are code constants, never user input.
 */
export function onlinePaymentMethodReadySql(pm = 'pm', qr = 'qr', mat = 'mat'): string {
  return `(
    ${pm}.active AND ${pm}.storefront_enabled AND ${pm}.rail <> 'cash'
    AND (
      (${pm}.presentation = 'material'
        AND ${mat}.lifecycle_status = 'accepted' AND ${mat}.purpose = 'payment_method_material')
      OR (${pm}.presentation = 'details' AND (
        (${pm}.rail = 'manual_qr' AND ${qr}.lifecycle_status = 'accepted' AND ${qr}.purpose = 'storefront_asset')
        OR (${pm}.rail = 'manual_transfer' AND NULLIF(btrim(${pm}.destination_snapshot ->> 'account_number'), '') IS NOT NULL)
      ))
    )
  )`;
}

export function paymentMethodFileJoinsSql(pm = 'pm', qr = 'qr', mat = 'mat'): string {
  return `LEFT JOIN file_object ${qr} ON ${qr}.tenant_id = ${pm}.tenant_id AND ${qr}.id = ${pm}.qr_file_id
          LEFT JOIN file_object ${mat} ON ${mat}.tenant_id = ${pm}.tenant_id AND ${mat}.id = ${pm}.material_file_id`;
}

/** Content types a business's payment instructions file may have (signature-checked on upload). */
export const PAYMENT_MATERIAL_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export type PaymentMaterialContentType = (typeof PAYMENT_MATERIAL_CONTENT_TYPES)[number];

export function isPaymentMaterialContentType(value: string): value is PaymentMaterialContentType {
  return (PAYMENT_MATERIAL_CONTENT_TYPES as readonly string[]).includes(value);
}
