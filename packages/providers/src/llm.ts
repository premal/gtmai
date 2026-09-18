import Anthropic, { type ClientOptions as AnthropicClientOptions } from '@anthropic-ai/sdk';
import OpenAI, { type ClientOptions as OpenAIClientOptions } from 'openai';
import { z } from 'zod';
import type { Provider, RunContext } from './types';

export const llmProviderIds = [
  'openai',
  'anthropic',
  'gemini',
  'perplexity',
  'openrouter',
  'cometapi',
] as const;
export type LlmProviderId = (typeof llmProviderIds)[number];

export function normalizeLlmProviderId(value: unknown): LlmProviderId {
  return (llmProviderIds as readonly string[]).includes(String(value))
    ? (value as LlmProviderId)
    : 'openai';
}

export const llmProviderModels: Record<LlmProviderId, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-5-mini', 'gpt-5'],
  anthropic: ['claude-3-5-haiku-latest', 'claude-sonnet-4-5', 'claude-opus-4-1'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  perplexity: ['sonar', 'sonar-pro', 'sonar-reasoning'],
  openrouter: [
    'openai/gpt-4o-mini',
    'openai/gpt-4o',
    'anthropic/claude-sonnet-4',
    'google/gemini-2.5-flash',
    'meta-llama/llama-3.3-70b-instruct',
    'deepseek/deepseek-chat-v3-0324',
  ],
  cometapi: [
    'gpt-4o-mini',
    'gpt-4o',
    'claude-sonnet-4-5',
    'gemini-2.5-flash',
    'grok-4',
    'deepseek-v3.1',
  ],
};

const chatInput = z.object({
  prompt: z.string(),
  model: z.string().optional(),
  schema: z.record(z.unknown()).optional(),
});
const scalarText = z
  .unknown()
  .transform((value) => (value == null || typeof value === 'object' ? '' : String(value)));
const output = z.object({
  answer: scalarText,
  fields: z.record(z.unknown()).catch({}),
  sources: z.array(z.string()).default([]),
  reasoning: scalarText,
});
export type AgentResult = z.infer<typeof output>;
export type AgentMessage = { role: 'system' | 'user' | 'tool'; content: string };
export type AgentClient = {
  complete(messages: AgentMessage[]): Promise<string>;
};

async function structuredChat(
  value: z.infer<typeof chatInput>,
  context: RunContext,
  provider: LlmProviderId,
): Promise<AgentResult> {
  const text = await sdkClient(context, provider, value.model).complete([
    { role: 'user', content: value.prompt },
  ]);
  return output.parse({
    ...(JSON.parse(text) as Record<string, unknown>),
    sources: [],
    reasoning: '',
  });
}

const llmAuthFields: Provider['auth']['fields'] = [
  { key: 'apiKey', label: 'API key', secret: true },
];

function llmChatProvider(
  id: LlmProviderId,
  name: string,
  check: NonNullable<Provider['check']>,
): Provider {
  return {
    id,
    name,
    group: 'ai',
    auth: { type: 'apiKey', fields: llmAuthFields },
    models: llmProviderModels[id],
    actions: [
      {
        id: `${id}.chat`,
        name: 'Structured chat',
        category: 'ai',
        input: chatInput,
        output,
        creditCost: 5,
        async run(value: unknown, context: RunContext) {
          try {
            return { found: true, data: await structuredChat(chatInput.parse(value), context, id) };
          } catch (error) {
            return {
              found: false,
              reason: error instanceof Error ? error.message : 'LLM request failed',
            };
          }
        },
      },
    ],
    check,
  };
}

export const openaiProvider = llmChatProvider(
  'openai',
  'OpenAI',
  async ({ credentials, fetch }) => {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${credentials.apiKey ?? ''}` },
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'OpenAI rejected the API key' };
    }
    return response.ok
      ? { ok: true }
      : { ok: false, message: `OpenAI returned HTTP ${response.status}` };
  },
);

export const anthropicProvider = llmChatProvider(
  'anthropic',
  'Anthropic',
  async ({ credentials, fetch }) => {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': credentials.apiKey ?? '',
        'anthropic-version': '2023-06-01',
      },
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'Anthropic rejected the API key' };
    }
    return response.ok
      ? { ok: true }
      : { ok: false, message: `Anthropic returned HTTP ${response.status}` };
  },
);

export const geminiProvider = llmChatProvider(
  'gemini',
  'Gemini',
  async ({ credentials, fetch }) => {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(credentials.apiKey ?? '')}`,
    );
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return { ok: false, message: 'Gemini rejected the API key' };
    }
    return response.ok
      ? { ok: true }
      : { ok: false, message: `Gemini returned HTTP ${response.status}` };
  },
);

export const perplexityProvider = llmChatProvider(
  'perplexity',
  'Perplexity',
  async ({ credentials, fetch }) => {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credentials.apiKey ?? ''}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: llmProviderModels.perplexity[0],
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'Perplexity rejected the API key' };
    }
    return response.ok
      ? { ok: true }
      : { ok: false, message: `Perplexity returned HTTP ${response.status}` };
  },
);

export const openrouterProvider = llmChatProvider(
  'openrouter',
  'OpenRouter',
  async ({ credentials, fetch }) => {
    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { authorization: `Bearer ${credentials.apiKey ?? ''}` },
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'OpenRouter rejected the API key' };
    }
    return response.ok
      ? { ok: true }
      : { ok: false, message: `OpenRouter returned HTTP ${response.status}` };
  },
);

export const cometapiProvider = llmChatProvider(
  'cometapi',
  'CometAPI',
  async ({ credentials, fetch }) => {
    const response = await fetch('https://api.cometapi.com/v1/models', {
      headers: { authorization: `Bearer ${credentials.apiKey ?? ''}` },
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'CometAPI rejected the API key' };
    }
    return response.ok
      ? { ok: true }
      : { ok: false, message: `CometAPI returned HTTP ${response.status}` };
  },
);

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

const openAiCompatibleBaseUrls: Partial<Record<LlmProviderId, string>> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  perplexity: 'https://api.perplexity.ai',
  openrouter: 'https://openrouter.ai/api/v1',
  cometapi: 'https://api.cometapi.com/v1',
};

// The vendor SDKs type their fetch option loosely; adapt RunContext.fetch.
function contextFetch(context: RunContext) {
  const fetcher = context.fetch;
  return (input: unknown, init?: unknown): Promise<Response> =>
    fetcher(input instanceof Request ? input : String(input), init as RequestInit);
}

function sdkClient(context: RunContext, provider: LlmProviderId, model?: string): AgentClient {
  if (provider === 'anthropic') {
    const client = new Anthropic({
      apiKey: context.credentials.apiKey,
      maxRetries: 5,
      fetch: contextFetch(context) as unknown as AnthropicClientOptions['fetch'],
    });
    return {
      async complete(messages) {
        const system = messages.find((item) => item.role === 'system')?.content;
        const response = await client.messages.create({
          model: model ?? llmProviderModels.anthropic[0]!,
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
  const client = new OpenAI({
    apiKey: context.credentials.apiKey,
    baseURL: openAiCompatibleBaseUrls[provider],
    maxRetries: 5,
    fetch: contextFetch(context) as unknown as OpenAIClientOptions['fetch'],
  });
  return {
    async complete(messages) {
      const response = await client.chat.completions.create({
        model: model ?? llmProviderModels[provider][0]!,
        messages: messages.map((item) => ({
          role: item.role === 'tool' ? ('user' as const) : item.role,
          content: item.content,
        })),
        // Gemini/Perplexity reject OpenAI-only params; the agent prompt enforces JSON.
        ...(provider === 'openai' ? { response_format: { type: 'json_object' as const } } : {}),
      });
      return response.choices[0]?.message.content ?? '{}';
    },
  };
}

export async function runAgent(
  prompt: string,
  context: RunContext,
  provider: LlmProviderId = 'openai',
  model?: string,
): Promise<AgentResult> {
  return runAgentWithClient(prompt, context, sdkClient(context, provider, model));
}

export async function completeChat(
  context: RunContext,
  messages: AgentMessage[],
  provider: LlmProviderId = 'openai',
  model?: string,
): Promise<string> {
  return sdkClient(context, provider, model).complete(messages);
}
