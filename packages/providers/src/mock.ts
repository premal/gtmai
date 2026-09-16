import { createHash } from 'node:crypto';
import { z } from 'zod';
import { peopleOutput, type Provider, type ProviderAction, type ActionResult } from './types';
const input = z.record(z.unknown());
const output = z.record(z.unknown());
const peopleInput = z.object({
  domain: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(3),
});
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
  const signalAction = action.endsWith('jobChanges') || action.endsWith('funding');
  if (signalAction && Number.parseInt(seed.slice(0, 2), 16) % 4 !== 0) {
    return {
      found: false,
      reason: 'No deterministic signal for this audience record',
    };
  }
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
    {
      id: 'mock.findPeople',
      name: 'Find people',
      category: 'search',
      sourceKind: 'people',
      input: peopleInput,
      output: peopleOutput,
      creditCost: 1,
      async run(value: unknown) {
        const input = peopleInput.parse(value);
        const domain = input.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        const slug = domain
          .replace(/[^a-z0-9]+/gi, '-')
          .replace(/^-|-$/g, '')
          .toLowerCase();
        const people = [
          ['Alex', 'Rivera', 'VP Revenue Operations', 'vp', 'revenue operations'],
          ['Sam', 'Chen', 'Head of Growth', 'director', 'growth'],
          ['Jordan', 'Patel', 'GTM Engineer', 'manager', 'engineering'],
        ].slice(0, input.limit);
        return {
          found: true,
          data: peopleOutput.parse({
            people: people.map(([firstName, lastName, title, seniority, department]) => ({
              firstName,
              lastName,
              fullName: `${firstName} ${lastName}`,
              title,
              seniority,
              department,
              email: `${String(firstName).toLowerCase()}@${domain}`,
              emailStatus: 'verified',
              linkedinUrl: `https://linkedin.com/in/${String(firstName).toLowerCase()}-${String(lastName).toLowerCase()}-${slug}`,
              company: { domain },
            })),
            total: 3,
          }),
        };
      },
    },
  ] as unknown as Provider['actions'],
};
