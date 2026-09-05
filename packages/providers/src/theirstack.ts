import { z } from 'zod';
import type { Provider, RunContext } from './types';

const technologyInput = z.object({
  domain: z.string().min(1),
  technologies: z.string().optional(),
});

const technologyOutput = z.object({
  technologies: z.array(
    z.object({
      name: z.string(),
      slug: z.string(),
      confidence: z.union([z.string(), z.number()]).optional(),
      jobsCount: z.number().optional(),
      lastSeen: z.string().optional(),
    }),
  ),
  technologyCount: z.number(),
  matched: z.array(z.string()),
  usesTechnology: z.boolean().nullable(),
});

const searchInput = z.object({
  technology: z.string().min(1),
  country: z.string().length(2).optional(),
  minEmployees: z.number().optional(),
  maxEmployees: z.number().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

const searchOutput = z.object({
  companies: z.array(
    z.object({
      name: z.string(),
      domain: z.string(),
      industry: z.string().optional(),
      employees: z.number().optional(),
      country: z.string().optional(),
      linkedinUrl: z.string().optional(),
      technologiesFound: z.array(z.string()).optional(),
    }),
  ),
  total: z.number().optional(),
});

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' ? (value as RecordValue) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function technologyItems(body: unknown): RecordValue[] {
  const root = record(body);
  const data = record(root.data);
  const value = root.technologies ?? data.technologies ?? root.data;
  return Array.isArray(value) ? value.map(record) : [];
}

function normalizeTechnology(item: RecordValue) {
  const name = stringValue(item.name ?? item.technology_name ?? item.technology) ?? '';
  const slug = stringValue(item.slug ?? item.technology_slug) ?? name;
  const confidence =
    typeof item.confidence === 'string' || typeof item.confidence === 'number'
      ? item.confidence
      : undefined;
  const jobsCount =
    typeof item.jobs_count === 'number'
      ? item.jobs_count
      : typeof item.jobsCount === 'number'
        ? item.jobsCount
        : undefined;
  const lastSeen = stringValue(item.last_seen ?? item.lastSeen);
  return { name, slug, confidence, jobsCount, lastSeen };
}

function normalizeSearchCompanies(body: unknown): {
  companies: z.infer<typeof searchOutput>['companies'];
  total?: number;
} {
  const root = record(body);
  const data = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.companies)
      ? root.companies
      : [];
  const companies = data.map((item) => {
    const value = record(item);
    const technologies = value.technologies_found ?? value.technologiesFound;
    const company = {
      name: stringValue(value.name ?? value.company_name) ?? '',
      domain: stringValue(value.domain ?? value.company_domain) ?? '',
    };
    const industry = stringValue(value.industry);
    const employees =
      typeof value.employees === 'number'
        ? value.employees
        : typeof value.employee_count === 'number'
          ? value.employee_count
          : undefined;
    const country = stringValue(value.country ?? value.company_country_code);
    const linkedinUrl = stringValue(value.linkedin_url ?? value.linkedinUrl);
    const technologiesFound = Array.isArray(technologies)
      ? technologies
          .map((technology) =>
            typeof technology === 'string'
              ? technology
              : stringValue(record(technology).name ?? record(technology).slug),
          )
          .filter((technology): technology is string => Boolean(technology))
      : undefined;
    return {
      ...company,
      ...(industry ? { industry } : {}),
      ...(employees === undefined ? {} : { employees }),
      ...(country ? { country } : {}),
      ...(linkedinUrl ? { linkedinUrl } : {}),
      ...(technologiesFound ? { technologiesFound } : {}),
    };
  });
  const total = typeof root.total === 'number' ? root.total : undefined;
  return total === undefined ? { companies } : { companies, total };
}

export const theirstackProvider: Provider = {
  id: 'theirstack',
  name: 'TheirStack',
  auth: { type: 'apiKey', fields: [{ key: 'apiKey', label: 'API key', secret: true }] },
  actions: [
    {
      id: 'theirstack.companyTechnologies',
      name: 'Company tech stack',
      category: 'company',
      input: technologyInput,
      output: technologyOutput,
      creditCost: 3,
      async run(value: unknown, context: RunContext) {
        const input = technologyInput.parse(value);
        const response = await context.fetch(
          'https://api.theirstack.com/v1/companies/technologies',
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${context.credentials.apiKey ?? ''}`,
            },
            body: JSON.stringify({ company_domain: input.domain }),
          },
        );
        if (!response.ok) {
          return {
            found: false,
            reason: `theirstack.companyTechnologies returned HTTP ${response.status}`,
          };
        }
        const technologies = technologyItems(await response.json()).map(normalizeTechnology);
        const requested = (input.technologies ?? '')
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean);
        const matched = technologies
          .filter((technology) => {
            const values = [technology.name, technology.slug].map((item) => item.toLowerCase());
            return requested.some((item) => values.includes(item));
          })
          .map((technology) => technology.slug);
        return {
          found: true,
          data: {
            technologies,
            technologyCount: technologies.length,
            matched,
            usesTechnology: requested.length ? matched.length > 0 : null,
          },
        };
      },
    },
    {
      id: 'theirstack.searchCompanies',
      name: 'Find companies by technology',
      category: 'search',
      sourceKind: 'companies',
      input: searchInput,
      output: searchOutput,
      creditCost: 3,
      async run(value: unknown, context: RunContext) {
        const input = searchInput.parse(value);
        const body: RecordValue = {
          company_technology_slug_or: [input.technology],
          limit: input.limit,
          page: 0,
        };
        if (input.country) body.company_country_code_or = [input.country];
        if (input.minEmployees !== undefined) body.min_employee_count = input.minEmployees;
        if (input.maxEmployees !== undefined) body.max_employee_count = input.maxEmployees;
        const response = await context.fetch('https://api.theirstack.com/v1/companies/search', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${context.credentials.apiKey ?? ''}`,
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          return {
            found: false,
            reason: `theirstack.searchCompanies returned HTTP ${response.status}`,
          };
        }
        return {
          found: true,
          data: searchOutput.parse(normalizeSearchCompanies(await response.json())),
        };
      },
    },
  ],
};
