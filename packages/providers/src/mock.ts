import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Provider, ProviderAction, ActionResult } from './types';
const input = z.record(z.unknown());
const output = z.record(z.unknown());
function fake(
  action: string,
  data: Record<string, unknown>,
): ActionResult<Record<string, unknown>> {
  const seed = createHash('sha256')
    .update(JSON.stringify([action, data]))
    .digest('hex');
  const domain = String(data.domain ?? 'example.com').replace(/^https?:\/\//, '');
  const first = String(data.firstName ?? 'alex').toLowerCase();
  const last = String(data.lastName ?? 'demo').toLowerCase();
  return {
    found: true,
    data: {
      email: `${first}.${last}@${domain}`,
      phone: `+1-555-${seed.slice(0, 3)}-${seed.slice(3, 7)}`,
      fullName: `${first} ${last}`,
      title: action.endsWith('enrichPerson') ? 'Engineer' : undefined,
      company: domain,
      confidence: 0.92,
      eventType: action.endsWith('jobChanges')
        ? 'job_change'
        : action.endsWith('funding')
          ? 'funding'
          : undefined,
      occurredAt: new Date(0).toISOString(),
    },
    raw: { seed },
  };
}
const action = (
  id: string,
  name: string,
  category: ProviderAction<Record<string, unknown>, Record<string, unknown>>['category'],
): ProviderAction<Record<string, unknown>, Record<string, unknown>> => ({
  id,
  name,
  category,
  input,
  output,
  creditCost: 1,
  run: async (data) => fake(id, data),
});
export const mockProvider: Provider = {
  id: 'mock',
  name: 'Mock',
  auth: { type: 'apiKey', fields: [{ key: 'apiKey', label: 'API key', secret: true }] },
  actions: [
    action('mock.findEmail', 'Find email', 'work_email'),
    action('mock.findPhone', 'Find phone', 'phone'),
    action('mock.enrichPerson', 'Enrich person', 'person'),
    action('mock.enrichCompany', 'Enrich company', 'company'),
    action('mock.verifyEmail', 'Verify email', 'verify'),
    action('mock.jobChanges', 'Job changes', 'other'),
    action('mock.funding', 'Funding events', 'other'),
  ] as unknown as Provider['actions'],
};
