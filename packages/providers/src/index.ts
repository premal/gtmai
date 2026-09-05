export * from './types';
export * from './mock';
export * from './http';
export * from './rest';
export * from './llm';
import {
  apolloProvider,
  datagmaProvider,
  hunterProvider,
  pdlProvider,
  prospeoProvider,
} from './rest';
import { httpProvider } from './http';
import { llmProvider } from './llm';
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
  httpProvider,
  llmProvider,
];
export const providerCatalog = providers.flatMap((provider) =>
  provider.actions.map((action) => ({
    provider: provider.id,
    ...action,
    badges: { costTier: action.creditCost < 3 ? 'low' : 'medium', regions: ['global'] },
  })),
);
