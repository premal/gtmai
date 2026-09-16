import { z } from 'zod';
import type { Provider, RunContext } from './types';

const BASE_URL = 'https://api.hginsights.com/data-api/v2';

const enrichInput = z.object({
  domain: z.string().min(1),
  productCategories: z.string().optional(),
});

const enrichOutput = z.object({
  hgId: z.string().optional(),
  name: z.string().optional(),
  domain: z.string().optional(),
  industry: z.string().optional(),
  employees: z.number().optional(),
  employeesBand: z.string().optional(),
  revenue: z.number().optional(),
  revenueBand: z.string().optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  technologies: z.array(
    z.object({
      name: z.string(),
      vendor: z.string().optional(),
      categories: z.array(z.string()),
      lastVerified: z.string().optional(),
      intensity: z.number().optional(),
    }),
  ),
  technologyCount: z.number(),
  matched: z.array(z.string()),
  usesTechnology: z.boolean().nullable(),
});

const searchInput = z.object({
  name: z.string().optional(),
  domain: z.string().optional(),
  country: z.string().length(2).optional(),
  minEmployees: z.number().int().optional(),
  maxEmployees: z.number().int().optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

const searchOutput = z.object({
  companies: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string(),
      domain: z.string().optional(),
    }),
  ),
  total: z.number().optional(),
});

const intentInput = z.object({
  domain: z.string().min(1),
  signalLevels: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

const intentOutput = z.object({
  company: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    domain: z.string().optional(),
  }),
  topics: z.array(
    z.object({
      name: z.string(),
      score: z.number().optional(),
      signalLevel: z.string().optional(),
      trend: z.number().optional(),
      buyersJourney: z.array(z.string()),
      vendors: z.array(z.string()),
      products: z.array(z.string()),
      lastSeen: z.string().optional(),
    }),
  ),
  topicsCount: z.number(),
  activeTopicsCount: z.number().optional(),
  highSignalCount: z.number().optional(),
  activitiesCount: z.number(),
  latestSignalDate: z.string().optional(),
});

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? (value as JsonRecord) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function csv(value: string | undefined): string[] {
  return (
    value
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

function headers(credentials: Record<string, string>): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${credentials.apiKey ?? ''}`,
  };
}

export const hginsightsProvider: Provider = {
  id: 'hginsights',
  name: 'HG Insights',
  group: 'enrichment',
  auth: { type: 'apiKey', fields: [{ key: 'apiKey', label: 'API key', secret: true }] },
  actions: [
    {
      id: 'hginsights.enrichCompany',
      name: 'Company technographics',
      category: 'company',
      input: enrichInput,
      output: enrichOutput,
      creditCost: 3,
      async run(value: unknown, context: RunContext) {
        const input = enrichInput.parse(value);
        const categories = csv(input.productCategories);
        const body: JsonRecord = {
          companies: { domains: [input.domain] },
          fields: ['firmographics', 'technographics'],
          filters: {
            technographics: {
              installs: { granularity: 'global' },
              ...(categories.length ? { product_categories: { names: categories } } : {}),
            },
          },
          pagination: { technographics: { sort: 'intensity' } },
        };
        const response = await context.fetch(`${BASE_URL}/companies/enrich`, {
          method: 'POST',
          headers: headers(context.credentials),
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          return {
            found: false,
            reason: `hginsights.enrichCompany returned HTTP ${response.status}`,
          };
        }
        const companies = record(await response.json()).companies;
        const company = record(Array.isArray(companies) ? companies[0] : undefined);
        const firmographics = record(company.firmographics);
        if (!Object.keys(company).length || !Object.keys(firmographics).length) {
          return { found: false, reason: 'no matching company' };
        }
        const technographics = record(company.technographics);
        const installs = Array.isArray(technographics.installs)
          ? technographics.installs.map(record)
          : [];
        const technologies = installs.map((install) => ({
          name: stringValue(install.product_name) ?? '',
          vendor: stringValue(install.vendor_name),
          categories: [
            install.product_category_level1_name,
            install.product_category_level2_name,
            install.product_category_level3_name,
            install.product_category_level4_name,
            install.product_category_level5_name,
          ].filter((item): item is string => typeof item === 'string'),
          lastVerified: stringValue(install.product_last_verified_date),
          intensity: numberValue(install.intensity),
        }));
        return {
          found: true,
          data: enrichOutput.parse({
            hgId: stringValue(firmographics.id),
            name: stringValue(firmographics.name),
            domain: stringValue(firmographics.domain ?? firmographics.domain_normalized),
            industry: stringValue(firmographics.industry_name),
            employees: numberValue(firmographics.employees_total),
            employeesBand: stringValue(firmographics.employees_band),
            revenue: numberValue(firmographics.revenue_total),
            revenueBand: stringValue(firmographics.revenue_band),
            country: stringValue(firmographics.country_code),
            state: stringValue(firmographics.state_name),
            city: stringValue(firmographics.city_name),
            technologies,
            technologyCount: numberValue(technographics.installs_count) ?? technologies.length,
            matched: categories.length ? technologies.map((item) => item.name) : [],
            usesTechnology: categories.length ? technologies.length > 0 : null,
          }),
        };
      },
    },
    {
      id: 'hginsights.searchCompanies',
      name: 'Company search',
      category: 'search',
      sourceKind: 'companies',
      input: searchInput,
      output: searchOutput,
      creditCost: 3,
      async run(value: unknown, context: RunContext) {
        const input = searchInput.parse(value);
        const identifiers: JsonRecord = {};
        if (input.name) identifiers.name = input.name;
        if (input.domain) {
          identifiers.domains = { ids: [input.domain], inclusion_method: 'ANY_PRESENT' };
        }
        const firmographics: JsonRecord = {};
        if (input.country) {
          firmographics.country_codes = [{ ids: [input.country], inclusion_method: 'ANY_PRESENT' }];
        }
        if (input.minEmployees !== undefined || input.maxEmployees !== undefined) {
          firmographics.employees = {
            ...(input.minEmployees !== undefined ? { min: input.minEmployees } : {}),
            ...(input.maxEmployees !== undefined ? { max: input.maxEmployees } : {}),
          };
        }
        const filters: JsonRecord = {
          ...(Object.keys(identifiers).length ? { company_identifiers: identifiers } : {}),
          ...(Object.keys(firmographics).length ? { firmographics } : {}),
        };
        const response = await context.fetch(`${BASE_URL}/companies/search`, {
          method: 'POST',
          headers: headers(context.credentials),
          body: JSON.stringify({
            fields: ['id', 'name', 'domain'],
            filters,
            limit: input.limit,
            offset: input.offset,
          }),
        });
        if (!response.ok) {
          return {
            found: false,
            reason: `hginsights.searchCompanies returned HTTP ${response.status}`,
          };
        }
        const root = record(await response.json());
        const companies = (Array.isArray(root.companies) ? root.companies : []).map((item) => {
          const company = record(item);
          return {
            id: stringValue(company.id),
            name: stringValue(company.name) ?? '',
            domain: stringValue(company.domain ?? company.domain_normalized),
          };
        });
        return {
          found: true,
          data: searchOutput.parse({ companies, total: numberValue(root.count) }),
        };
      },
    },
    {
      id: 'hginsights.intentSignals',
      name: 'Intent signals',
      category: 'other',
      input: intentInput,
      output: intentOutput,
      creditCost: 2,
      async run(value: unknown, context: RunContext) {
        const input = intentInput.parse(value);
        const levels = csv(input.signalLevels).map((item) => item.toUpperCase());
        const response = await context.fetch(`${BASE_URL}/intent/enrich`, {
          method: 'POST',
          headers: headers(context.credentials),
          body: JSON.stringify({
            company: { domain: input.domain },
            limit: input.limit,
            filters: {
              topics: {
                granularity: 'global',
                ...(levels.length ? { signal_level: levels } : {}),
              },
            },
          }),
        });
        if (!response.ok) {
          return {
            found: false,
            reason: `hginsights.intentSignals returned HTTP ${response.status}`,
          };
        }
        const root = record(await response.json());
        const company = record(root.company);
        const topics = record(root.topics);
        const summary = record(root.summary);
        const activities = record(root.activities);
        const items = (Array.isArray(topics.data) ? topics.data : []).map((item) => {
          const topic = record(item);
          const journey = stringList(topic.buyers_journey_names);
          const single = stringValue(topic.buyers_journey_name);
          return {
            name: stringValue(topic.name) ?? '',
            score: numberValue(topic.score),
            signalLevel: stringValue(topic.signal_level),
            trend: numberValue(topic.trend),
            buyersJourney: journey.length ? journey : single ? [single] : [],
            vendors: stringList(topic.vendor_names),
            products: stringList(topic.product_names),
            lastSeen: stringValue(topic.last_seen_at),
          };
        });
        return {
          found: true,
          data: intentOutput.parse({
            company: {
              id: stringValue(company.id),
              name: stringValue(company.name),
              domain: stringValue(company.domain),
            },
            topics: items,
            topicsCount: numberValue(topics.count) ?? items.length,
            activeTopicsCount: numberValue(summary.active_topics_count),
            highSignalCount: numberValue(summary.high_signal_topics_count),
            activitiesCount: numberValue(activities.count) ?? 0,
            latestSignalDate: stringValue(summary.latest_signal_date),
          }),
        };
      },
    },
  ],
  check: async ({ credentials, fetch }) => {
    const apiKey = credentials.apiKey ?? '';
    if (!apiKey) return { ok: false, message: 'API key is empty' };
    const response = await fetch(`${BASE_URL}/credits`, {
      headers: headers(credentials),
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'HG Insights rejected the API key' };
    }
    return response.ok
      ? { ok: true }
      : { ok: false, message: `HG Insights returned HTTP ${response.status}` };
  },
};
