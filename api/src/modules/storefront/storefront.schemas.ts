import { z } from 'zod';

/**
 * Zod is the source of truth for both request shapes (AGENTS.md: "Use Zod schemas as the
 * source of truth. Derive TypeScript types with z.infer.") — every type below is inferred,
 * never hand-duplicated.
 */

export const storefrontSlugParamsSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits and hyphens only'),
});
export type StorefrontSlugParams = z.infer<typeof storefrontSlugParamsSchema>;

// Bounded window: an unbounded availability query would force a full-table range scan against
// asset_allocation for every asset the tenant owns (TRD §9: "bounded calendar windows").
const MAX_AVAILABILITY_WINDOW_DAYS = 60;

export const availabilityQuerySchema = z
  .object({
    variant_id: z.string().uuid(),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .refine((value) => new Date(value.to) > new Date(value.from), {
    message: '"to" must be after "from"',
    path: ['to'],
  })
  .refine(
    (value) => {
      const spanMs = new Date(value.to).getTime() - new Date(value.from).getTime();
      return spanMs <= MAX_AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    },
    { message: `date range may not exceed ${MAX_AVAILABILITY_WINDOW_DAYS} days`, path: ['to'] },
  );
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
