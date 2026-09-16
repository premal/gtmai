export * from './types';
export * from './mock';
export * from './http';
export * from './rest';
export * from './llm';
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
import { anthropicProvider, geminiProvider, openaiProvider, perplexityProvider } from './llm';
import { mockProvider } from './mock';
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
];
export const providerCatalog = providers.flatMap((provider) =>
  provider.actions.map((action) => ({
    provider: provider.id,
    ...action,
    badges: { costTier: action.creditCost < 3 ? 'low' : 'medium', regions: ['global'] },
  })),
);
