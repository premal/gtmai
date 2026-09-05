import { z } from 'zod';
export type ActionResult<O> =
  | { found: true; data: O; raw?: unknown }
  | { found: false; reason?: string };
export type RunContext = {
  credentials: Record<string, string>;
  fetch: typeof fetch;
  logger: { info(message: string): void; error(message: string): void };
};
export type ProviderAction<I = unknown, O = unknown> = {
  id: string;
  name: string;
  category:
    | 'work_email'
    | 'personal_email'
    | 'phone'
    | 'person'
    | 'company'
    | 'verify'
    | 'search'
    | 'ai'
    | 'other';
  sourceKind?: 'companies' | 'people';
  input: z.ZodTypeAny;
  output: z.ZodTypeAny;
  creditCost: number;
  run(input: I, ctx: RunContext): Promise<ActionResult<O>>;
};
export const peopleOutput = z.object({
  people: z.array(
    z.object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      fullName: z.string().optional(),
      title: z.string().optional(),
      seniority: z.string().optional(),
      department: z.string().optional(),
      linkedinUrl: z.string().optional(),
      email: z.string().optional(),
      emailStatus: z.string().optional(),
      company: z
        .object({
          name: z.string().optional(),
          domain: z.string().optional(),
        })
        .optional(),
    }),
  ),
  total: z.number().optional(),
});
export type Provider = {
  id: string;
  name: string;
  auth: {
    type: 'apiKey';
    fields: { key: string; label: string; secret: true; optional?: boolean }[];
  };
  actions: ProviderAction<unknown, unknown>[];
};
