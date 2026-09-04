import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import type { Provider, RunContext } from './types';

const input = z.object({
  prompt: z.string(),
  provider: z.enum(['openai', 'anthropic']).default('openai'),
  model: z.string().optional(),
  schema: z.record(z.unknown()).optional(),
});
const output = z.object({
  answer: z.string(),
  fields: z.record(z.unknown()),
  sources: z.array(z.string()),
  reasoning: z.string(),
});
export type AgentResult = z.infer<typeof output>;

async function structuredChat(
  value: z.infer<typeof input>,
  context: RunContext,
): Promise<AgentResult> {
  if (value.provider === 'anthropic') {
    const client = new Anthropic({ apiKey: context.credentials.apiKey });
    const response = await client.messages.create({
      model: value.model ?? 'claude-3-5-haiku-latest',
      max_tokens: 2_000,
      messages: [{ role: 'user', content: value.prompt }],
    });
    const text = response.content.find((item) => item.type === 'text')?.text ?? '{}';
    return output.parse({
      ...(JSON.parse(text) as Record<string, unknown>),
      sources: [],
      reasoning: '',
    });
  }
  const client = new OpenAI({ apiKey: context.credentials.apiKey });
  const response = await client.chat.completions.create({
    model: value.model ?? 'gpt-4o-mini',
    messages: [{ role: 'user', content: value.prompt }],
    response_format: { type: 'json_object' },
  });
  const text = response.choices[0]?.message.content ?? '{}';
  return output.parse({
    ...(JSON.parse(text) as Record<string, unknown>),
    sources: [],
    reasoning: '',
  });
}

export const llmProvider: Provider = {
  id: 'llm',
  name: 'LLM',
  auth: { type: 'apiKey', fields: [{ key: 'apiKey', label: 'API key', secret: true }] },
  actions: [
    {
      id: 'llm.chat',
      name: 'Structured chat',
      category: 'ai',
      input,
      output,
      creditCost: 5,
      async run(value: unknown, context: RunContext) {
        try {
          return { found: true, data: await structuredChat(input.parse(value), context) };
        } catch (error) {
          return {
            found: false,
            reason: error instanceof Error ? error.message : 'LLM request failed',
          };
        }
      },
    },
  ],
};

async function fetchPage(url: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url);
  const html = await response.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 20_000);
}

async function webSearch(
  query: string,
  context: RunContext,
): Promise<{ text: string; sources: string[] }> {
  if (context.credentials.tavilyApiKey) {
    const response = await context.fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: context.credentials.tavilyApiKey, query, max_results: 5 }),
    });
    const body = (await response.json()) as {
      results?: { title: string; url: string; content: string }[];
    };
    const results = body.results ?? [];
    return {
      text: results.map((item) => `${item.title}: ${item.content}`).join('\n'),
      sources: results.map((item) => item.url),
    };
  }
  const response = await context.fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  );
  const text = await response.text();
  const sources = [...text.matchAll(/result__a[^>]+href="([^"]+)/g)]
    .slice(0, 5)
    .map((match) => match[1]!);
  return {
    text: text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 20_000),
    sources,
  };
}

export async function runAgent(prompt: string, context: RunContext): Promise<AgentResult> {
  const search = await webSearch(prompt, context);
  const page = search.sources[0] ? await fetchPage(search.sources[0], context.fetch) : '';
  const augmented = `${prompt}\n\nSearch results:\n${search.text}\n\nPage text:\n${page}`;
  const result = await structuredChat({ prompt: augmented, provider: 'openai' }, context);
  return output.parse({ ...result, sources: [...new Set([...search.sources, ...result.sources])] });
}
