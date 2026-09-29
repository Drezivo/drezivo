import { z } from 'zod';

/** Parse environment booleans without JavaScript's truthiness conversion of "false". */
export function strictBooleanEnv(name: string): z.ZodType<boolean, z.ZodTypeDef, unknown> {
  return z.preprocess((value, ctx) => {
    if (value === undefined || typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${name} must be true or false`,
    });
    return z.NEVER;
  }, z.boolean());
}
