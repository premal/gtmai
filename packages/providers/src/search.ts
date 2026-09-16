import { z } from 'zod';
import type { Provider, RunContext } from './types';

export const searchInput = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(20).default(5),
});
export const searchOutput = z.object({
  results: z.array(
    z.object({
      title: z.string().optional(),
      url: z.string().optional(),
      content: z.string().optional(),
    }),
  ),
});

const apiKeyAuth = {
  type: 'apiKey' as const,
  fields: [{ key: 'apiKey', label: 'API key', secret: true as const }],
};

export const exaProvider: Provider = {
  id: 'exa',
  name: 'Exa',
  group: 'search',
  auth: apiKeyAuth,
  actions: [
    {
      id: 'exa.search',
      name: 'Web search',
      category: 'search',
      input: searchInput,
      output: searchOutput,
      creditCost: 1,
      async run(value: unknown, context: RunContext) {
        const input = searchInput.parse(value);
        const response = await context.fetch('https://api.exa.ai/search', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': context.credentials.apiKey ?? '',
          },
          body: JSON.stringify({
            query: input.query,
            numResults: input.maxResults,
            type: 'auto',
            contents: { text: { maxCharacters: 2_000 } },
          }),
        });
        if (!response.ok) {
          return { found: false, reason: `exa.search returned HTTP ${response.status}` };
        }
        const body = (await response.json()) as {
          results?: { title?: string; url?: string; text?: string }[];
        };
        const results = (body.results ?? []).map((item) => ({
          title: item.title,
          url: item.url,
          content: item.text,
        }));
        return { found: true, data: searchOutput.parse({ results }), raw: body };
      },
    },
  ],
  async check({ credentials, fetch }) {
    const response = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': credentials.apiKey ?? '',
      },
      body: JSON.stringify({ query: 'ping', numResults: 1 }),
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'Exa rejected the API key' };
    }
    return response.ok
      ? { ok: true }
      : { ok: false, message: `Exa returned HTTP ${response.status}` };
  },
};

export const parallelProvider: Provider = {
  id: 'parallel',
  name: 'Parallel',
  group: 'search',
  auth: apiKeyAuth,
  actions: [
    {
      id: 'parallel.search',
      name: 'Web search',
      category: 'search',
      input: searchInput,
      output: searchOutput,
      creditCost: 1,
      async run(value: unknown, context: RunContext) {
        const input = searchInput.parse(value);
        const response = await context.fetch('https://api.parallel.ai/v1/search', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': context.credentials.apiKey ?? '',
          },
          body: JSON.stringify({
            search_queries: [input.query],
            mode: 'turbo',
            advanced_settings: { max_results: input.maxResults },
          }),
        });
        if (!response.ok) {
          return { found: false, reason: `parallel.search returned HTTP ${response.status}` };
        }
        const body = (await response.json()) as {
          results?: { title?: string; url?: string; excerpts?: string[] }[];
        };
        const results = (body.results ?? []).map((item) => ({
          title: item.title,
          url: item.url,
          content: (item.excerpts ?? []).join('\n') || undefined,
        }));
        return { found: true, data: searchOutput.parse({ results }), raw: body };
      },
    },
  ],
  async check({ credentials, fetch }) {
    const response = await fetch('https://api.parallel.ai/v1/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': credentials.apiKey ?? '',
      },
      body: JSON.stringify({ search_queries: ['ping'], mode: 'turbo' }),
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'Parallel rejected the API key' };
    }
    return response.ok
      ? { ok: true }
      : { ok: false, message: `Parallel returned HTTP ${response.status}` };
  },
};
