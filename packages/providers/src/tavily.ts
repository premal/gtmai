import { searchInput, searchOutput } from './search';
import type { Provider, RunContext } from './types';

export const tavilyProvider: Provider = {
  id: 'tavily',
  name: 'Tavily',
  group: 'search',
  auth: { type: 'apiKey', fields: [{ key: 'apiKey', label: 'API key', secret: true }] },
  actions: [
    {
      id: 'tavily.search',
      name: 'Web search',
      category: 'search',
      input: searchInput,
      output: searchOutput,
      creditCost: 1,
      async run(value: unknown, context: RunContext) {
        const input = searchInput.parse(value);
        const response = await context.fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            api_key: context.credentials.apiKey ?? '',
            query: input.query,
            max_results: input.maxResults,
          }),
        });
        if (!response.ok) {
          return { found: false, reason: `tavily.search returned HTTP ${response.status}` };
        }
        const body = (await response.json()) as { results?: unknown };
        return {
          found: true,
          data: searchOutput.parse({ results: body.results ?? [] }),
          raw: body,
        };
      },
    },
  ],
  async check({ credentials, fetch }) {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: credentials.apiKey ?? '', query: 'ping', max_results: 1 }),
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'Tavily rejected the API key' };
    }
    return response.ok
      ? { ok: true }
      : { ok: false, message: `Tavily returned HTTP ${response.status}` };
  },
};
