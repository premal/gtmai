import emailWaterfall from './templates/find-work-email-waterfall.json';
import jobChangeEnrichAppend from './templates/job-change-enrich-append.json';
import newSignalsWebhook from './templates/new-signals-webhook.json';
import normalizeCompanyName from './templates/normalize-company-name.json';

export const builtInTemplates = [
  emailWaterfall,
  jobChangeEnrichAppend,
  normalizeCompanyName,
  newSignalsWebhook,
] as const;
