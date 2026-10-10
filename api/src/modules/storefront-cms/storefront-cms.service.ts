import type { PoolClient } from 'pg';

import {
  defaultStorefrontDocument,
  storefrontDocument,
  storefrontSettings,
  type PermissionCode,
  type PublishStorefrontPolicyRequest,
  type StorefrontDocument,
  type StorefrontPreviewLink,
  type StorefrontReadiness,
  type StorefrontSettings,
  type UpdateStorefrontRequest,
  type UpdateStorefrontSlugRequest,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import type { StaffContext } from '../../middleware/staff-command.js';
import {
  ForbiddenError,
  NotFoundError,
  StaleVersionError,
  StateConflictError,
  TenantCancelledError,
  TenantRestrictedError,
  ValidationError,
} from '../../shared/errors.js';
import { runIdempotentCommand, type CommandResult } from '../../shared/idempotent-command.js';
import { enqueueReplacedFileObjectCleanup } from '../files/file-object-cleanup.repository.js';
import {
  appendSettingsAudit,
  readTenantSettings,
  syncBusinessContactFromStorefront,
} from '../settings/settings.repository.js';
import { storefrontMediaSigner, type StorefrontMediaSigner } from '../storefront/storefront-media.js';
import { fromPolicyColumns, toPolicyColumns } from '../storefront/storefront-policy.js';
import { issuePreviewToken } from '../storefront/storefront-preview.js';
import {
  appendStorefrontAudit,
  findAcceptedStorefrontAssets,
  findActiveProducts,
  insertPolicyVersion,
  readCurrentPolicy,
  readReadiness,
  readStorefront,
  transitionStorefront,
  updateStorefrontDocument,
  updateStorefrontSlug,
  type PolicyRow,
  type StorefrontRow,
} from './storefront-cms.repository.js';

const MANAGE_PERMISSION: PermissionCode = 'policies.manage';
const UNIQUE_VIOLATION = '23505';

/**
 * Owner-facing storefront CMS. Reads are open to any staff member of the workspace; every write
 * needs `policies.manage`, runs once per Idempotency-Key, and only lands if the caller edited the
 * current version.
 */
export class StorefrontCmsService {
  constructor(private readonly media: StorefrontMediaSigner = storefrontMediaSigner) {}

  get(context: StaffContext): Promise<StorefrontSettings> {
    return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
      const row = await this.requireStorefront(client, context.tenantId, false);
      return this.view(client, context.tenantId, row);
    });
  }

  /** Read-only preview credential for this workspace's storefront. Issuing it changes nothing. */
  preview(context: StaffContext): Promise<StorefrontPreviewLink> {
    return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
      const row = await this.requireStorefront(client, context.tenantId, false);
      const { token, expiresAt } = issuePreviewToken({ tenantId: context.tenantId, storefrontId: row.id });
      return { slug: row.slug, token, expires_at: expiresAt.toISOString() };
    });
  }

  updateDocument(context: StaffContext, idempotencyKey: string, request: UpdateStorefrontRequest): Promise<CommandResult<StorefrontSettings>> {
    return this.command(context, idempotencyKey, 'storefront.document.update', request, async (client, row) => {
      this.assertVersion(row, request.version);
      const previousDocument = toDocument(row);
      // Lock tenant settings after the storefront row so cross-page contact sync uses one lock order.
      await readTenantSettings(client, context.tenantId, true);
      await this.assertReferencesBelongToWorkspace(client, context.tenantId, request.document);
      await updateStorefrontDocument(client, {
        tenantId: context.tenantId,
        storefrontId: row.id,
        expectedVersion: request.version,
        document: request.document,
      });
      const replacedMedia: Array<[string | null, string | null]> = [
        [previousDocument.branding.logo_file_id, request.document.branding.logo_file_id],
        [previousDocument.branding.cover_file_id, request.document.branding.cover_file_id],
        [previousDocument.content.hero.image_file_id, request.document.content.hero.image_file_id],
        [previousDocument.content.about.image_file_id, request.document.content.about.image_file_id],
      ];
      const currentMedia = new Set(
        replacedMedia.flatMap(([, replacementFileId]) => replacementFileId ? [replacementFileId] : []),
      );
      for (const [previousFileId, replacementFileId] of replacedMedia) {
        if (previousFileId && !currentMedia.has(previousFileId)) {
          await enqueueReplacedFileObjectCleanup(client, context.tenantId, previousFileId, replacementFileId);
        }
      }
      const businessContactChanged = await syncBusinessContactFromStorefront(client, {
        tenantId: context.tenantId,
        businessEmail: request.document.contact.email,
        businessPhone: request.document.contact.phone,
        businessAddress: request.document.contact.address,
      });
      if (businessContactChanged) {
        await appendSettingsAudit(client, {
          tenantId: context.tenantId,
          actorKey: context.principalId,
          action: 'settings.business.contact.synced_from_storefront',
          summary: {
            has_email: request.document.contact.email !== null,
            has_phone: request.document.contact.phone !== null,
            has_address: request.document.contact.address !== null,
          },
          requestId: context.requestId,
        });
      }
      return { action: 'storefront.document.updated', summary: { theme: request.document.branding.theme } };
    });
  }

  updateSlug(context: StaffContext, idempotencyKey: string, request: UpdateStorefrontSlugRequest): Promise<CommandResult<StorefrontSettings>> {
    return this.command(context, idempotencyKey, 'storefront.slug.update', request, async (client, row) => {
      this.assertVersion(row, request.version);
      if (row.slug === request.slug) return null;
      try {
        await updateStorefrontSlug(client, {
          tenantId: context.tenantId,
          storefrontId: row.id,
          expectedVersion: request.version,
          slug: request.slug,
        });
      } catch (error) {
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
          throw new StateConflictError('That storefront address is already taken. Try another one.');
        }
        throw error;
      }
      return { action: 'storefront.slug.updated', summary: { slug: request.slug } };
    });
  }

  publish(context: StaffContext, idempotencyKey: string, version: number): Promise<CommandResult<StorefrontSettings>> {
    return this.command(context, idempotencyKey, 'storefront.publish', { version }, async (client, row) => {
      this.assertVersion(row, version);
      if (row.status === 'suspended') throw new StateConflictError('This storefront is suspended by Drezivo support.');
      if (row.status === 'published') return null;
      const readiness = await this.readiness(client, context.tenantId, row, await readCurrentPolicy(client, context.tenantId, row.id));
      const missing = [
        !readiness.has_policy && 'a rental policy',
        !readiness.has_active_clothing && 'at least one active clothing item',
        !readiness.has_storefront_payment_method && 'a storefront payment method',
        !readiness.has_contact && 'a contact phone or email',
      ].filter(Boolean);
      if (missing.length > 0) throw new ValidationError(`Add ${missing.join(', ')} before publishing.`);
      await transitionStorefront(client, { tenantId: context.tenantId, storefrontId: row.id, expectedVersion: version, from: 'draft', to: 'published' });
      return { action: 'storefront.published', summary: {} };
    });
  }

  unpublish(context: StaffContext, idempotencyKey: string, version: number): Promise<CommandResult<StorefrontSettings>> {
    return this.command(context, idempotencyKey, 'storefront.unpublish', { version }, async (client, row) => {
      this.assertVersion(row, version);
      if (row.status !== 'published') return null;
      await transitionStorefront(client, { tenantId: context.tenantId, storefrontId: row.id, expectedVersion: version, from: 'published', to: 'draft' });
      return { action: 'storefront.unpublished', summary: {} };
    });
  }

  publishPolicy(context: StaffContext, idempotencyKey: string, request: PublishStorefrontPolicyRequest): Promise<CommandResult<StorefrontSettings>> {
    return this.command(context, idempotencyKey, 'storefront.policy.publish', request, async (client, row) => {
      const current = await readCurrentPolicy(client, context.tenantId, row.id);
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== request.expected_version) {
        throw new StaleVersionError('The rental policy changed since you opened it. Reload and review the latest version.');
      }
      const imageIds = request.rules.image_file_ids;
      const accepted = await findAcceptedStorefrontAssets(client, context.tenantId, imageIds);
      if (imageIds.some((id) => !accepted.has(id))) {
        throw new ValidationError('One of the policy images is not an uploaded storefront image from this workspace.');
      }
      await insertPolicyVersion(client, {
        tenantId: context.tenantId,
        storefrontId: row.id,
        version: currentVersion + 1,
        columns: toPolicyColumns(request.rules),
      });
      return { action: 'storefront.policy.published', summary: { version: currentVersion + 1 } };
    });
  }

  /** Shared write path. `change` returns the audit entry, or null when the request changed nothing. */
  private command(
    context: StaffContext,
    idempotencyKey: string,
    operation: string,
    payload: unknown,
    change: (client: PoolClient, row: StorefrontRow) => Promise<{ action: string; summary: Record<string, unknown> } | null>,
  ): Promise<CommandResult<StorefrontSettings>> {
    if (!context.permissionCodes.includes(MANAGE_PERMISSION)) {
      throw new ForbiddenError('Only the business owner can change the storefront.');
    }
    if (context.effectiveTenantStatus === 'restricted') throw new TenantRestrictedError('This workspace is temporarily restricted.');
    if (context.effectiveTenantStatus === 'cancelled') throw new TenantCancelledError('This workspace is closed.');

    return withTenantTransaction(context.tenantId, context.principalId, (client) =>
      runIdempotentCommand(
        client,
        { tenantId: context.tenantId, principalKey: context.membershipId, operation, intentKey: idempotencyKey, requestId: context.requestId },
        payload,
        async () => {
          const row = await this.requireStorefront(client, context.tenantId, true);
          const audit = await change(client, row);
          if (audit) {
            await appendStorefrontAudit(client, {
              tenantId: context.tenantId,
              actorKey: context.principalId,
              storefrontId: row.id,
              action: audit.action,
              summary: audit.summary,
              requestId: context.requestId,
            });
          }
          const fresh = await this.requireStorefront(client, context.tenantId, false);
          return this.view(client, context.tenantId, fresh);
        },
      ),
    );
  }

  private async requireStorefront(client: PoolClient, tenantId: string, forUpdate: boolean): Promise<StorefrontRow> {
    const row = await readStorefront(client, tenantId, forUpdate);
    if (!row) throw new NotFoundError('This workspace does not have a storefront yet.');
    return row;
  }

  private assertVersion(row: StorefrontRow, expected: number): void {
    if (row.version !== expected) {
      throw new StaleVersionError('The storefront changed since you opened it. Reload to see the latest version.');
    }
  }

  private async assertReferencesBelongToWorkspace(client: PoolClient, tenantId: string, document: StorefrontDocument): Promise<void> {
    const fileIds = [
      document.branding.logo_file_id,
      document.branding.cover_file_id,
      document.content.hero.image_file_id,
      document.content.about.image_file_id,
    ].flatMap((id): string[] => (id === null ? [] : [id]));
    const accepted = await findAcceptedStorefrontAssets(client, tenantId, fileIds);
    if (fileIds.some((id) => !accepted.has(id))) {
      throw new ValidationError('One of the images is not an uploaded storefront image from this workspace.');
    }
    const products = await findActiveProducts(client, tenantId, document.content.featured_product_ids);
    if (document.content.featured_product_ids.some((id) => !products.has(id))) {
      throw new ValidationError('Featured clothing must be active items from this workspace.');
    }
  }

  private async readiness(client: PoolClient, tenantId: string, row: StorefrontRow, policy: PolicyRow | null): Promise<StorefrontReadiness> {
    const document = toDocument(row);
    const counts = await readReadiness(client, tenantId);
    const has_policy = policy !== null && fromPolicyColumns(policy) !== null;
    const has_contact = document.contact.phone !== null || document.contact.email !== null;
    return {
      has_policy,
      has_active_clothing: counts.has_active_clothing,
      has_storefront_payment_method: counts.has_storefront_payment_method,
      has_contact,
      ready: has_policy && counts.has_active_clothing && counts.has_storefront_payment_method && has_contact,
    };
  }

  private async view(client: PoolClient, tenantId: string, row: StorefrontRow): Promise<StorefrontSettings> {
    const document = toDocument(row);
    const policy = await readCurrentPolicy(client, tenantId, row.id);
    const readiness = await this.readiness(client, tenantId, row, policy);
    const rules = policy ? fromPolicyColumns(policy) : null;
    const policyImageIds = rules?.image_file_ids ?? [];
    const urls = await this.media.sign(client, tenantId, [
      document.branding.logo_file_id,
      document.branding.cover_file_id,
      document.content.hero.image_file_id,
      document.content.about.image_file_id,
      ...policyImageIds,
    ]);
    const urlOf = (id: string | null): string | null => (id ? (urls.get(id) ?? null) : null);
    const policyImageUrls = Object.fromEntries(
      policyImageIds.flatMap((id) => {
        const url = urls.get(id);
        return url ? [[id, url]] : [];
      }),
    );

    return storefrontSettings.parse({
      slug: row.slug,
      status: row.status,
      version: row.version,
      published_at: row.published_at?.toISOString() ?? null,
      updated_at: row.updated_at.toISOString(),
      public_path: `/s/${row.slug}`,
      document,
      media: {
        logo_url: urlOf(document.branding.logo_file_id),
        cover_url: urlOf(document.branding.cover_file_id),
        hero_image_url: urlOf(document.content.hero.image_file_id),
        about_image_url: urlOf(document.content.about.image_file_id),
      },
      policy: {
        version: policy?.version ?? 1,
        effective_at: (policy?.effective_at ?? row.updated_at).toISOString(),
        rules,
        image_urls: policyImageUrls,
      },
      readiness,
    });
  }
}

/** Bootstrap rows store empty objects; hydrate missing sections before validating the saved document. */
export function toDocument(row: Pick<StorefrontRow, 'branding' | 'contact' | 'content' | 'checkout' | 'tenant_name'>): StorefrontDocument {
  const defaults = defaultStorefrontDocument(row.tenant_name);
  const parsed = storefrontDocument.safeParse({
    branding: { ...defaults.branding, ...row.branding },
    contact: { ...defaults.contact, ...row.contact },
    content: { ...defaults.content, ...row.content },
    checkout: { ...defaults.checkout, ...row.checkout },
  });
  return parsed.success ? parsed.data : defaults;
}

export const storefrontCmsService = new StorefrontCmsService();
