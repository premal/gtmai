export * from './types';
export * from './mock';
export * from './http';
export * from './rest';
export * from './llm';
export * from './tavily';
export * from './search';
export * from './hginsights';
import {
  apolloProvider,
  datagmaProvider,
  hunterProvider,
  pdlProvider,
  prospeoProvider,
} from './rest';
import { hginsightsProvider } from './hginsights';
import { httpProvider } from './http';
import {
  anthropicProvider,
  cometapiProvider,
  geminiProvider,
  openaiProvider,
  openrouterProvider,
  perplexityProvider,
} from './llm';
import { mockProvider } from './mock';
import { exaProvider, parallelProvider } from './search';
import { tavilyProvider } from './tavily';
import { theirstackProvider } from './theirstack';
import type { Provider } from './types';
export const providers: Provider[] = [
  mockProvider,
  hunterProvider,
  prospeoProvider,
  datagmaProvider,
  apolloProvider,
  pdlProvider,
  theirstackProvider,
  hginsightsProvider,
  httpProvider,
  openaiProvider,
  anthropicProvider,
  geminiProvider,
  perplexityProvider,
  openrouterProvider,
  cometapiProvider,
  tavilyProvider,
  exaProvider,
  parallelProvider,
];
export const providerCatalog = providers.flatMap((provider) =>
  provider.actions.map((action) => ({
    provider: provider.id,
    ...action,
    badges: { costTier: action.creditCost < 3 ? 'low' : 'medium', regions: ['global'] },
  })),
);
