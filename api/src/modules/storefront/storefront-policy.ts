import { storefrontPolicyRules, type StorefrontPolicyRules } from '@drezivo/contracts';

/**
 * Maps the owner's policy form onto the immutable `policy_snapshot` JSON columns. The reservation
 * quote reads `delivery_rules.enabled` and `delivery_rules.fee_minor`, so those two keys keep the
 * exact names and types it expects; the prose lives beside them under `summary`.
 */
export interface PolicySnapshotColumns {
  rental_rules: Record<string, unknown>;
  deposit_rules: Record<string, unknown>;
  cancellation_rules: Record<string, unknown>;
  delivery_rules: Record<string, unknown>;
  privacy_notice: string;
}

export function toPolicyColumns(rules: StorefrontPolicyRules): PolicySnapshotColumns {
  return {
    rental_rules: { summary: rules.rental, damage: rules.damage },
    deposit_rules: { summary: rules.deposit },
    cancellation_rules: { summary: rules.cancellation },
    delivery_rules: { enabled: rules.delivery.enabled, fee_minor: rules.delivery.fee_minor, summary: rules.delivery.notes },
    privacy_notice: rules.privacy_notice,
  };
}

/**
 * Reads a snapshot back into form rules. Snapshots seeded at workspace bootstrap are empty, so this
 * returns null until the owner publishes a real policy — the storefront cannot go live on one.
 */
export function fromPolicyColumns(columns: PolicySnapshotColumns): StorefrontPolicyRules | null {
  const parsed = storefrontPolicyRules.safeParse({
    rental: columns.rental_rules['summary'],
    deposit: columns.deposit_rules['summary'],
    cancellation: columns.cancellation_rules['summary'],
    damage: columns.rental_rules['damage'] ?? null,
    delivery: {
      enabled: columns.delivery_rules['enabled'] === true,
      fee_minor: minorUnitsText(columns.delivery_rules['fee_minor']),
      notes: columns.delivery_rules['summary'] ?? null,
    },
    privacy_notice: columns.privacy_notice,
  });
  return parsed.success ? parsed.data : null;
}

function minorUnitsText(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return typeof value === 'string' ? value : '0';
}
