import { z } from 'zod';
import type { Provider, ProviderAction, RunContext } from './types';

export const enrichmentSchema = z.object({
  email: z.string().optional(),
  emailStatus: z.string().optional(),
  phone: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  title: z.string().optional(),
  linkedinUrl: z.string().optional(),
  company: z
    .object({
      name: z.string().optional(),
      domain: z.string().optional(),
      industry: z.string().optional(),
      size: z.union([z.string(), z.number()]).optional(),
      location: z.string().optional(),
      linkedinUrl: z.string().optional(),
    })
    .optional(),
});

type JsonRecord = Record<string, unknown>;
type Method = 'GET' | 'POST';
type AuthMode = 'hunter' | 'prospeo' | 'datagma' | 'apollo' | 'pdl';

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? (value as JsonRecord) : {};
}

function normalize(value: unknown): z.infer<typeof enrichmentSchema> {
  const envelope = record(value);
  const data = record(envelope.data ?? envelope.person ?? envelope.organization ?? value);
  const company = record(data.company ?? data.organization ?? data.org);
  return enrichmentSchema.parse({
    email: typeof data.email === 'string' ? data.email : undefined,
    emailStatus: typeof data.email_status === 'string' ? data.email_status : data.status,
    phone: typeof data.phone === 'string' ? data.phone : data.mobile_phone,
    firstName: data.first_name ?? data.firstName,
    lastName: data.last_name ?? data.lastName,
    title: data.title ?? data.job_title,
    linkedinUrl: data.linkedin_url ?? data.linkedinUrl,
    company: {
      name: company.name,
      domain: company.domain,
      industry: company.industry,
      size: company.size ?? company.employee_count,
      location: company.location ?? company.city,
      linkedinUrl: company.linkedin_url ?? company.linkedinUrl,
    },
  });
}

function stringify(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function action(
  id: string,
  name: string,
  category: ProviderAction['category'],
  input: z.ZodTypeAny,
  endpoint: string,
  method: Method,
  creditCost: number,
  map: (value: unknown) => unknown = normalize,
  authMode: AuthMode = 'datagma',
): ProviderAction {
  return {
    id,
    name,
    category,
    input,
    output: enrichmentSchema,
    creditCost,
    async run(value: unknown, context: RunContext) {
      const parsed = input.parse(value) as JsonRecord;
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (authMode === 'prospeo') headers['X-KEY'] = context.credentials.apiKey ?? '';
      else if (authMode === 'apollo') headers['x-api-key'] = context.credentials.apiKey ?? '';
      else if (authMode === 'pdl') headers['X-API-Key'] = context.credentials.apiKey ?? '';
      else headers.Authorization = `Bearer ${context.credentials.apiKey ?? ''}`;
      const query =
        authMode === 'hunter'
          ? { ...stringify(parsed), api_key: context.credentials.apiKey ?? '' }
          : stringify(parsed);
      const url =
        method === 'GET'
          ? `${endpoint}?${new URLSearchParams(query as Record<string, string>)}`
          : endpoint;
      const response = await context.fetch(url, {
        method,
        headers,
        ...(method === 'POST' ? { body: JSON.stringify(parsed) } : {}),
      });
      if (!response.ok) {
        return { found: false, reason: `${id} returned HTTP ${response.status}` };
      }
      const body = await response.json();
      return { found: true, data: map(body), raw: body };
    },
  };
}

const personInput = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().optional(),
  domain: z.string().optional(),
  linkedinUrl: z.string().optional(),
  linkedin_url: z.string().optional(),
});
const companyInput = z.object({ domain: z.string().min(1) });

function provider(id: string, name: string, actions: ProviderAction[]): Provider {
  return {
    id,
    name,
    auth: { type: 'apiKey', fields: [{ key: 'apiKey', label: 'API key', secret: true }] },
    actions,
  };
}

export const hunterProvider = provider('hunter', 'Hunter', [
  action(
    'hunter.findEmail',
    'Email finder',
    'work_email',
    personInput,
    'https://api.hunter.io/v2/email-finder',
    'GET',
    2,
    (value) => normalize(record(value).data),
    'hunter',
  ),
  action(
    'hunter.verifyEmail',
    'Email verifier',
    'verify',
    z.object({ email: z.string().email() }),
    'https://api.hunter.io/v2/email-verifier',
    'GET',
    1,
    (value) => normalize(record(value).data),
    'hunter',
  ),
  action(
    'hunter.domainSearch',
    'Domain search',
    'search',
    companyInput,
    'https://api.hunter.io/v2/domain-search',
    'GET',
    2,
    (value) => normalize(record(value).data),
    'hunter',
  ),
  action(
    'hunter.enrichCompany',
    'Company enrichment',
    'company',
    companyInput,
    'https://api.hunter.io/v2/companies/find',
    'GET',
    2,
    normalize,
    'hunter',
  ),
]);

export const prospeoProvider = provider('prospeo', 'Prospeo', [
  action(
    'prospeo.findEmail',
    'Email finder',
    'work_email',
    personInput,
    'https://api.prospeo.io/email-finder',
    'POST',
    2,
    normalize,
    'prospeo',
  ),
  action(
    'prospeo.findMobile',
    'Mobile finder',
    'phone',
    personInput,
    'https://api.prospeo.io/mobile-finder',
    'POST',
    3,
    normalize,
    'prospeo',
  ),
  action(
    'prospeo.enrichCompany',
    'Company enrichment',
    'company',
    companyInput,
    'https://api.prospeo.io/company-enrich',
    'POST',
    2,
    normalize,
    'prospeo',
  ),
]);

export const datagmaProvider = provider('datagma', 'Datagma', [
  action(
    'datagma.enrich',
    'Full enrichment',
    'person',
    personInput,
    'https://api.datagma.com/api/enrich',
    'POST',
    3,
    normalize,
    'datagma',
  ),
]);

export const apolloProvider = provider('apollo', 'Apollo', [
  action(
    'apollo.peopleMatch',
    'People match',
    'person',
    personInput,
    'https://api.apollo.io/v1/people/match',
    'POST',
    3,
    normalize,
    'apollo',
  ),
  action(
    'apollo.orgEnrich',
    'Organization enrich',
    'company',
    companyInput,
    'https://api.apollo.io/v1/organizations/enrich',
    'POST',
    2,
    normalize,
    'apollo',
  ),
]);

export const pdlProvider = provider('peopledatalabs', 'People Data Labs', [
  action(
    'peopledatalabs.personEnrich',
    'Person enrich',
    'person',
    personInput,
    'https://api.peopledatalabs.com/v5/person/enrich',
    'GET',
    3,
    normalize,
    'pdl',
  ),
  action(
    'peopledatalabs.companyEnrich',
    'Company enrich',
    'company',
    companyInput,
    'https://api.peopledatalabs.com/v5/company/enrich',
    'GET',
    2,
    normalize,
    'pdl',
  ),
]);
