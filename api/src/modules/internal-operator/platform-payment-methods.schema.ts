import { z } from 'zod';

// Reject ASCII control characters in operator-supplied text.
// eslint-disable-next-line no-control-regex
const line = /^[^\u0000-\u001f\u007f]*$/;
// eslint-disable-next-line no-control-regex
const multiline = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;
const optionalText = (max: number, pattern: RegExp): z.ZodNullable<z.ZodString> => z.string().trim().max(max).regex(pattern).nullable();
const image = z.object({ data_base64: z.string().min(4).max(Math.ceil(512 * 1024 / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict();
const fields = {
  label: z.string().trim().min(1).max(80).regex(line),
  account_name: optionalText(160, line),
  account_number: optionalText(120, line),
  instructions: optionalText(1000, multiline),
  sort_order: z.number().int().min(0).max(1000),
  reason: z.string().trim().min(3).max(500).regex(line),
};
export const createPlatformMethod = z.object({ ...fields, qr: image.nullable() }).strict();
export const updatePlatformMethod = z.object({ ...fields, version: z.number().int().positive(), qr: image.nullable().optional() }).strict();
export type CreatePlatformMethod = z.infer<typeof createPlatformMethod>;
export type UpdatePlatformMethod = z.infer<typeof updatePlatformMethod>;
