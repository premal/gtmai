import { z } from 'zod';
import type { Provider, RunContext } from './types';
const input = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  url: z.string(),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
});
const output = z.unknown();
export const httpProvider: Provider = {
  id: 'http',
  name: 'HTTP',
  auth: { type: 'apiKey', fields: [] },
  actions: [
    {
      id: 'http.request',
      name: 'HTTP request',
      category: 'other',
      input,
      output,
      creditCost: 1,
      run: async (
        value: {
          method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
          url: string;
          headers?: Record<string, string>;
          body?: unknown;
        },
        ctx: RunContext,
      ) => {
        const init: RequestInit = { method: value.method };
        if (value.headers) init.headers = value.headers;
        if (value.body !== undefined) init.body = JSON.stringify(value.body);
        const response = await ctx.fetch(value.url, init);
        if (!response.ok) return { found: false, reason: `HTTP ${response.status}` };
        return { found: true, data: await response.json() };
      },
    },
  ] as unknown as Provider['actions'],
};
