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
  answer: z.string().default(''),
  fields: z.record(z.unknown()).default({}),
  sources: z.array(z.string()).default([]),
  reasoning: z.string().default(''),
});
export type AgentResult = z.infer<typeof output>;
export type AgentMessage = { role: 'system' | 'user' | 'tool'; content: string };
export type AgentClient = {
  complete(messages: AgentMessage[]): Promise<string>;
};

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
  auth: {
    type: 'apiKey',
    fields: [
      { key: 'apiKey', label: 'API key', secret: true },
      {
        key: 'tavilyApiKey',
        label: 'Tavily API key (optional — web search; falls back to DuckDuckGo)',
        secret: true,
        optional: true,
      },
    ],
  },
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

export async function fetchPage(url: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url);
  const html = await response.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 20_000);
}

export async function webSearch(
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

type AgentPayload = {
  answer?: unknown;
  fields?: unknown;
  sources?: unknown;
  reasoning?: unknown;
};

function parseToolMessage(value: string): AgentPayload & {
  tool?: 'web_search' | 'fetch_page' | 'finish';
  arguments?: Record<string, string>;
  result?: AgentPayload;
  raw?: string;
} {
  try {
    const parsed = JSON.parse(value) as AgentPayload & {
      tool?: 'web_search' | 'fetch_page' | 'finish';
      arguments?: Record<string, string>;
      result?: AgentPayload;
    };
    if (
      !parsed.tool &&
      ('answer' in parsed || 'fields' in parsed || 'sources' in parsed || 'reasoning' in parsed)
    ) {
      return { ...parsed, tool: 'finish' };
    }
    return parsed;
  } catch {
    return { tool: 'finish', raw: value };
  }
}

export async function runAgentWithClient(
  prompt: string,
  context: RunContext,
  client: AgentClient,
): Promise<AgentResult> {
  const messages: AgentMessage[] = [
    {
      role: 'system',
      content:
        'You are a research agent. Respond only as JSON: {"tool":"web_search"|"fetch_page"|"finish","arguments":{},"result":{}}. Finish result must contain answer, fields, sources, and reasoning; never omit those keys, even when a field is empty.',
    },
    { role: 'user', content: prompt },
  ];
  const sources: string[] = [];
  for (let step = 0; step < 8; step += 1) {
    const message = parseToolMessage(await client.complete(messages));
    if (message.tool === 'finish') {
      if (message.raw !== undefined) {
        return { answer: message.raw, fields: {}, sources, reasoning: 'unparsed' };
      }
      const topLevelPayload =
        'answer' in message ||
        'fields' in message ||
        'sources' in message ||
        'reasoning' in message;
      const result = message.result ?? (topLevelPayload ? message : {});
      const resultSources = Array.isArray(result.sources)
        ? result.sources.filter((source): source is string => typeof source === 'string')
        : [];
      try {
        return output.parse({
          ...result,
          sources: [...new Set([...resultSources, ...sources])],
        });
      } catch {
        return {
          answer: message.raw ?? '',
          fields: {},
          sources,
          reasoning: 'unparsed',
        };
      }
    }
    if (message.tool === 'web_search') {
      const result = await webSearch(message.arguments?.query ?? prompt, context);
      sources.push(...result.sources);
      messages.push({ role: 'tool', content: JSON.stringify({ tool: 'web_search', ...result }) });
      continue;
    }
    if (message.tool === 'fetch_page') {
      const url = message.arguments?.url;
      if (!url) {
        messages.push({ role: 'tool', content: JSON.stringify({ error: 'url is required' }) });
        continue;
      }
      const text = await fetchPage(url, context.fetch);
      sources.push(url);
      messages.push({ role: 'tool', content: JSON.stringify({ tool: 'fetch_page', url, text }) });
      continue;
    }
    messages.push({ role: 'tool', content: JSON.stringify({ error: 'Unknown tool' }) });
  }
  return { answer: 'Agent reached its step limit.', fields: {}, sources, reasoning: 'max_steps' };
}

function sdkClient(
  context: RunContext,
  provider: 'openai' | 'anthropic',
  model?: string,
): AgentClient {
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: context.credentials.apiKey });
    return {
      async complete(messages) {
        const system = messages.find((item) => item.role === 'system')?.content;
        const response = await client.messages.create({
          model: model ?? 'claude-3-5-haiku-latest',
          max_tokens: 2_000,
          ...(system ? { system } : {}),
          messages: messages
            .filter((item) => item.role !== 'system')
            .map((item) => ({
              role: 'user' as const,
              content: item.content,
            })),
        });
        return response.content.find((item) => item.type === 'text')?.text ?? '{}';
      },
    };
  }
  const client = new OpenAI({ apiKey: context.credentials.apiKey });
  return {
    async complete(messages) {
      const response = await client.chat.completions.create({
        model: model ?? 'gpt-4o-mini',
        messages: messages.map((item) => ({
          role: item.role === 'tool' ? ('user' as const) : item.role,
          content: item.content,
        })),
        response_format: { type: 'json_object' },
      });
      return response.choices[0]?.message.content ?? '{}';
    },
  };
}

export async function runAgent(
  prompt: string,
  context: RunContext,
  provider: 'openai' | 'anthropic' = 'openai',
  model?: string,
): Promise<AgentResult> {
  return runAgentWithClient(prompt, context, sdkClient(context, provider, model));
}
