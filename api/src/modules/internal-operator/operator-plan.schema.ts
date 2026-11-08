import { z } from 'zod';

export const operatorPlanCode = z.enum(['starter', 'standard', 'growth', 'scale']);
export type OperatorPlanCode = z.infer<typeof operatorPlanCode>;

export const operatorPlanRequest = z.object({
  plan_code: operatorPlanCode,
  // eslint-disable-next-line no-control-regex
  reason: z.string().trim().min(3).max(500).regex(/^[^\u0000-\u001f\u007f]*$/).optional(),
}).strict();
