import { resolveBindingsDeep } from './bindings';

export type SequenceContact = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  data?: unknown;
};

export type SequenceCompany = {
  name?: string | null;
  domain?: string | null;
  data?: unknown;
};

export function renderSequenceTemplate(
  template: string,
  contact: SequenceContact,
  company?: SequenceCompany | null,
): string {
  const rendered = resolveBindingsDeep(template, { contact, company: company ?? {} });
  return typeof rendered === 'string' ? rendered : String(rendered ?? '');
}
