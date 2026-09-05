import { z } from 'zod';
import { peopleOutput, type Provider, type ProviderAction, type RunContext } from './types';

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
      (entry): entry is [string, string | number | boolean] =>
        typeof entry[1] === 'string' ||
        typeof entry[1] === 'number' ||
        typeof entry[1] === 'boolean',
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
const hunterPeopleInput = z.object({
  domain: z.string().min(1),
  department: z.string().optional(),
  seniority: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(10),
});
const apolloPeopleInput = z.object({
  domain: z.string().min(1),
  titles: z.string().optional(),
  seniorities: z.string().optional(),
  departments: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(10),
});

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
  {
    id: 'hunter.domainSearch',
    name: 'Domain search',
    category: 'search',
    sourceKind: 'people',
    input: hunterPeopleInput,
    output: peopleOutput,
    creditCost: 2,
    async run(value: unknown, context: RunContext) {
      const input = hunterPeopleInput.parse(value);
      const query = new URLSearchParams({
        domain: input.domain,
        limit: String(input.limit),
        api_key: context.credentials.apiKey ?? '',
        ...(input.department ? { department: input.department } : {}),
        ...(input.seniority ? { seniority: input.seniority } : {}),
      });
      const response = await context.fetch(
        `https://api.hunter.io/v2/domain-search?${query.toString()}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
        },
      );
      if (!response.ok) {
        return { found: false, reason: `hunter.domainSearch returned HTTP ${response.status}` };
      }
      const body = record(await response.json());
      const data = record(body.data);
      const organization = record(data.organization);
      const emails = Array.isArray(data.emails) ? data.emails : [];
      const people = emails.map((item) => {
        const person = record(item);
        return {
          firstName: typeof person.first_name === 'string' ? person.first_name : undefined,
          lastName: typeof person.last_name === 'string' ? person.last_name : undefined,
          title: typeof person.position === 'string' ? person.position : undefined,
          seniority: typeof person.seniority === 'string' ? person.seniority : undefined,
          department: typeof person.department === 'string' ? person.department : undefined,
          linkedinUrl: typeof person.linkedin === 'string' ? person.linkedin : undefined,
          email: typeof person.value === 'string' ? person.value : undefined,
          emailStatus: person.confidence === undefined ? undefined : String(person.confidence),
          company: {
            name:
              typeof organization.name === 'string'
                ? organization.name
                : typeof data.organization === 'string'
                  ? data.organization
                  : undefined,
            domain: typeof data.domain === 'string' ? data.domain : input.domain,
          },
        };
      });
      return {
        found: true,
        data: peopleOutput.parse({ people, total: data.total }),
        raw: body,
      };
    },
  },
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
  {
    id: 'apollo.peopleSearch',
    name: 'People search',
    category: 'search',
    sourceKind: 'people',
    input: apolloPeopleInput,
    output: peopleOutput,
    creditCost: 2,
    async run(value: unknown, context: RunContext) {
      const input = apolloPeopleInput.parse(value);
      const split = (items: string | undefined) =>
        items
          ?.split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      const body = {
        q_organization_domains_list: [input.domain],
        ...(split(input.titles) ? { person_titles: split(input.titles) } : {}),
        ...(split(input.seniorities) ? { person_seniorities: split(input.seniorities) } : {}),
        ...(split(input.departments) ? { person_departments: split(input.departments) } : {}),
        per_page: input.limit,
        page: 1,
      };
      const response = await context.fetch('https://api.apollo.io/api/v1/mixed_people/search', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': context.credentials.apiKey ?? '',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        return { found: false, reason: `apollo.peopleSearch returned HTTP ${response.status}` };
      }
      const bodyValue = record(await response.json());
      const pagination = record(bodyValue.pagination);
      const people = (Array.isArray(bodyValue.people) ? bodyValue.people : []).map((item) => {
        const person = record(item);
        const organization = record(person.organization);
        const departments = Array.isArray(person.departments) ? person.departments : [];
        return {
          firstName: typeof person.first_name === 'string' ? person.first_name : undefined,
          lastName: typeof person.last_name === 'string' ? person.last_name : undefined,
          fullName: typeof person.name === 'string' ? person.name : undefined,
          title: typeof person.title === 'string' ? person.title : undefined,
          seniority: typeof person.seniority === 'string' ? person.seniority : undefined,
          department: typeof departments[0] === 'string' ? departments[0] : undefined,
          linkedinUrl: typeof person.linkedin_url === 'string' ? person.linkedin_url : undefined,
          email: typeof person.email === 'string' ? person.email : undefined,
          emailStatus: typeof person.email_status === 'string' ? person.email_status : undefined,
          company: {
            name: typeof organization.name === 'string' ? organization.name : undefined,
            domain:
              typeof organization.primary_domain === 'string'
                ? organization.primary_domain
                : undefined,
          },
        };
      });
      return {
        found: true,
        data: peopleOutput.parse({
          people,
          total:
            typeof pagination.total_entries === 'number' ? pagination.total_entries : undefined,
        }),
        raw: bodyValue,
      };
    },
  },
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
