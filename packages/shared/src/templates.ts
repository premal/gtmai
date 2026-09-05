import emailWaterfall from './templates/find-work-email-waterfall.json';
import findClayUsers from './templates/find-clay-users.json';
import jobChangeEnrichAppend from './templates/job-change-enrich-append.json';
import newSignalsWebhook from './templates/new-signals-webhook.json';
import normalizeCompanyName from './templates/normalize-company-name.json';
import outboundSignalEnroll from './templates/outbound-signal-enroll.json';

export const builtInTemplates = [
  emailWaterfall,
  findClayUsers,
  jobChangeEnrichAppend,
  normalizeCompanyName,
  newSignalsWebhook,
  outboundSignalEnroll,
] as const;
