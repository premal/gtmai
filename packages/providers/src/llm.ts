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
  if (!response.ok) {
    return JSON.stringify({ error: `HTTP ${response.status}` });
  }
  const html = await response.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 20_000);
}

export type SearchParseResult = {
  text: string;
  sources: string[];
};

const decodeHtml = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const cleanSearchText = (value: string): string =>
  decodeHtml(
    value
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );

const decodeSearchHref = (value: string): string => {
  const href = decodeHtml(value);
  const redirect = href.match(/[?&]uddg=([^&]+)/)?.[1];
  if (redirect) {
    try {
      return decodeURIComponent(redirect);
    } catch {
      return redirect;
    }
  }
  try {
    const url = new URL(href);
    const encoded = url.searchParams.get('u');
    if (encoded?.startsWith('a1')) {
      return atob(encoded.slice(2));
    }
  } catch {
    // Preserve non-URL search links.
  }
  return href.startsWith('//') ? `https:${href}` : href;
};

export function parseDuckDuckGo(html: string): SearchParseResult {
  const sourceMatches = [...html.matchAll(/result__a[^>]+href="([^"]+)/g)].slice(0, 5);
  const snippets = [...html.matchAll(/result__snippet[^>]*>([\s\S]*?)<\/(?:a|div|span)>/g)]
    .slice(0, 5)
    .map((match) => cleanSearchText(match[1]!));
  return {
    text: snippets.join('\n').slice(0, 20_000),
    sources: sourceMatches.map((match) => decodeSearchHref(match[1]!)),
  };
}

export function parseBing(html: string): SearchParseResult {
  const blocks = [...html.matchAll(/<li[^>]*class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<\/li>/gi)];
  const results = blocks
    .map((match) => {
      const block = match[0];
      const href = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"/i)?.[1];
      const title = block.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i)?.[1];
      const snippet = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1];
      return href
        ? {
            source: decodeSearchHref(href),
            text: [title ? cleanSearchText(title) : '', snippet ? cleanSearchText(snippet) : '']
              .filter(Boolean)
              .join(': '),
          }
        : null;
    })
    .filter((result): result is { source: string; text: string } => result !== null)
    .slice(0, 5);
  return {
    text: results
      .map((result) => result.text)
      .filter(Boolean)
      .join('\n')
      .slice(0, 20_000),
    sources: results.map((result) => result.source),
  };
}

type WebSearchResult = SearchParseResult & {
  unavailable?: boolean;
};

export async function webSearch(query: string, context: RunContext): Promise<WebSearchResult> {
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
    context.logger.info('web_search backend=tavily');
    return {
      text: results.map((item) => `${item.title}: ${item.content}`).join('\n'),
      sources: results.map((item) => item.url),
    };
  }
  const attempts = [
    {
      name: 'duckduckgo',
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      headers: { 'accept-language': 'en-US' },
      parse: parseDuckDuckGo,
    },
    {
      name: 'bing',
      url: `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`,
      headers: {
        accept: 'text/html',
        'accept-language': 'en-US',
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
      },
      parse: parseBing,
    },
  ] as const;
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const response = await context.fetch(attempt.url, {
        headers: attempt.headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        failures.push(`${attempt.name} HTTP ${response.status}`);
        continue;
      }
      const parsed = attempt.parse(await response.text());
      if (parsed.sources.length === 0) {
        failures.push(`${attempt.name} returned no results`);
        continue;
      }
      context.logger.info(`web_search backend=${attempt.name}`);
      return parsed;
    } catch (error) {
      failures.push(
        `${attempt.name}: ${error instanceof Error ? error.message : 'request failed'}`,
      );
    }
  }
  return {
    text: `Search unavailable: ${failures.join('; ')}`,
    sources: [],
    unavailable: true,
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
  const searchFailures: string[] = [];
  let successfulSearches = 0;
  const parseFinish = async (message: ReturnType<typeof parseToolMessage>) => {
    if (message.raw !== undefined) {
      return { answer: message.raw, fields: {}, sources, reasoning: 'unparsed' };
    }
    const topLevelPayload =
      'answer' in message || 'fields' in message || 'sources' in message || 'reasoning' in message;
    const result = message.result ?? (topLevelPayload ? message : {});
    const resultSources = Array.isArray(result.sources)
      ? result.sources.filter((source): source is string => typeof source === 'string')
      : [];
    try {
      const parsed = output.parse({
        ...result,
        sources: [...new Set([...resultSources, ...sources])],
      });
      if (searchFailures.length > 0 && successfulSearches === 0) {
        parsed.reasoning = [parsed.reasoning, `search_unavailable: ${searchFailures.join('; ')}`]
          .filter(Boolean)
          .join(' ');
      }
      if (Object.keys(parsed.fields).length === 0 && /\bfields\b/i.test(prompt)) {
        try {
          const repair = JSON.parse(
            await client.complete([
              {
                role: 'system',
                content:
                  'Extract the structured fields requested by the user prompt from the research answer. Respond only as JSON: {"fields": {...}}. Use "unknown"/""/0 when not determined.',
              },
              {
                role: 'user',
                content: `Prompt:\n${prompt}\n\nAnswer:\n${parsed.answer}\n\nSources:\n${sources.join('\n')}`,
              },
            ]),
          ) as { fields?: unknown };
          if (repair.fields && typeof repair.fields === 'object' && !Array.isArray(repair.fields)) {
            parsed.fields = repair.fields as Record<string, unknown>;
          }
        } catch {
          // Keep the original finish result when field repair fails.
        }
      }
      return parsed;
    } catch {
      return {
        answer: message.raw ?? '',
        fields: {},
        sources,
        reasoning: 'unparsed',
      };
    }
  };
  for (let step = 0; step < 12; step += 1) {
    const message = parseToolMessage(await client.complete(messages));
    if (message.tool === 'finish') return parseFinish(message);
    if (message.tool === 'web_search') {
      try {
        const result = await webSearch(message.arguments?.query ?? prompt, context);
        sources.push(...result.sources);
        if (result.unavailable) {
          searchFailures.push(result.text);
        } else {
          successfulSearches += 1;
        }
        messages.push({ role: 'tool', content: JSON.stringify({ tool: 'web_search', ...result }) });
      } catch (error) {
        messages.push({
          role: 'tool',
          content: JSON.stringify({
            tool: 'web_search',
            error: error instanceof Error ? error.message : 'search failed',
          }),
        });
      }
      continue;
    }
    if (message.tool === 'fetch_page') {
      const url = message.arguments?.url;
      if (!url) {
        messages.push({ role: 'tool', content: JSON.stringify({ error: 'url is required' }) });
        continue;
      }
      try {
        const text = await fetchPage(url, context.fetch);
        sources.push(url);
        messages.push({ role: 'tool', content: JSON.stringify({ tool: 'fetch_page', url, text }) });
      } catch (error) {
        messages.push({
          role: 'tool',
          content: JSON.stringify({
            tool: 'fetch_page',
            url,
            error: error instanceof Error ? error.message : 'fetch failed',
          }),
        });
      }
      continue;
    }
    messages.push({ role: 'tool', content: JSON.stringify({ error: 'Unknown tool' }) });
  }
  messages.push({
    role: 'user',
    content:
      'You have no tool calls left. Respond now with {"tool":"finish","result":{answer,fields,sources,reasoning}} using the evidence gathered so far; use "unknown" where undetermined.',
  });
  try {
    const forced = parseToolMessage(await client.complete(messages));
    if (forced.tool === 'finish') {
      const result = await parseFinish(forced);
      if (!result.reasoning) result.reasoning = 'max_steps';
      return result;
    }
  } catch {
    // Return the step-limit fallback when forced finish fails.
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
