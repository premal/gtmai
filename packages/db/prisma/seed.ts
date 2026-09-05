import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
type SeedColumn = {
  id: string;
  name: string;
  kind: string;
};

const people = [
  ['Ada', 'Lovelace', 'analytical.engine', 'Analytical Engines'],
  ['Grace', 'Hopper', 'navy.mil', 'US Navy'],
  ['Alan', 'Turing', 'turing.ai', 'Turing AI'],
  ['Katherine', 'Johnson', 'nasa.gov', 'NASA'],
  ['Margaret', 'Hamilton', 'apollo.dev', 'Apollo Software'],
  ['Tim', 'Berners-Lee', 'web.org', 'Web Foundation'],
  ['Radia', 'Perlman', 'networking.io', 'Networking Labs'],
  ['Linus', 'Torvalds', 'linux.dev', 'Linux Foundation'],
  ['James', 'Gosling', 'java.dev', 'Java Systems'],
  ['Barbara', 'Liskov', 'distributed.systems', 'Distributed Systems'],
  ['Edsger', 'Dijkstra', 'algorithms.org', 'Algorithms Org'],
  ['Donald', 'Knuth', 'stanford.edu', 'Stanford'],
  ['Frances', 'Allen', 'compiler.ai', 'Compiler AI'],
  ['Anita', 'Borg', 'women.tech', 'Women Tech'],
  ['John', 'McCarthy', 'lisp.ai', 'Lisp AI'],
  ['Yoshua', 'Bengio', 'montreal.ai', 'Montreal AI'],
  ['Fei-Fei', 'Li', 'vision.ai', 'Vision AI'],
  ['Demis', 'Hassabis', 'deepmind.com', 'DeepMind'],
  ['Aparna', 'Chennapragada', 'product.dev', 'Product Dev'],
  ['Melanie', 'Perkins', 'design.tools', 'Design Tools'],
] as const;

function encrypt(value: Record<string, string>): string {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY is required');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

async function main(): Promise<void> {
  const passwordHash = await argon2.hash('demo1234');
  const user = await db.user.upsert({
    where: { email: 'demo@gtmai.dev' },
    update: { passwordHash },
    create: { email: 'demo@gtmai.dev', name: 'Demo User', passwordHash },
  });
  const existingMembership = await db.membership.findFirst({ where: { userId: user.id } });
  const workspace = existingMembership
    ? await db.workspace.findUniqueOrThrow({ where: { id: existingMembership.workspaceId } })
    : await db.workspace.create({
        data: {
          name: 'Demo Workspace',
          users: { create: { userId: user.id, role: 'owner' } },
        },
      });
  const editor = await db.user.upsert({
    where: { email: 'editor@gtmai.dev' },
    update: { passwordHash, name: 'Demo Editor' },
    create: { email: 'editor@gtmai.dev', name: 'Demo Editor', passwordHash },
  });
  await db.membership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: editor.id } },
    update: { role: 'editor' },
    create: { workspaceId: workspace.id, userId: editor.id, role: 'editor' },
  });
  const viewer = await db.user.upsert({
    where: { email: 'viewer@gtmai.dev' },
    update: { passwordHash, name: 'Demo Viewer' },
    create: { email: 'viewer@gtmai.dev', name: 'Demo Viewer', passwordHash },
  });
  await db.membership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: viewer.id } },
    update: { role: 'viewer' },
    create: { workspaceId: workspace.id, userId: viewer.id, role: 'viewer' },
  });
  const defaultWorkbook =
    (await db.workbook.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })) ??
    (await db.workbook.create({
      data: { workspaceId: workspace.id, name: 'Default workbook', position: 0 },
    }));
  const q3Folder =
    (await db.folder.findFirst({ where: { workspaceId: workspace.id, name: 'Q3 campaigns' } })) ??
    (await db.folder.create({
      data: { workspaceId: workspace.id, name: 'Q3 campaigns', position: 0 },
    }));
  (await db.workbook.findFirst({
    where: { workspaceId: workspace.id, folderId: q3Folder.id, name: 'Q3 campaigns' },
  })) ??
    (await db.workbook.create({
      data: {
        workspaceId: workspace.id,
        folderId: q3Folder.id,
        name: 'Q3 campaigns',
        position: 0,
      },
    }));
  const connection = await db.connection.findFirst({
    where: { workspaceId: workspace.id, provider: 'mock' },
  });
  if (connection) {
    await db.connection.update({
      where: { id: connection.id },
      data: { encryptedCredentials: encrypt({ apiKey: 'demo-mock-key' }) },
    });
  } else {
    await db.connection.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        provider: 'mock',
        name: 'Mock Provider',
        encryptedCredentials: encrypt({ apiKey: 'demo-mock-key' }),
      },
    });
  }
  const oldTable = await db.table.findFirst({
    where: { workspaceId: workspace.id, name: 'Prospects' },
  });
  if (oldTable) await db.table.delete({ where: { id: oldTable.id } });
  const table = await db.table.create({
    data: {
      workspaceId: workspace.id,
      workbookId: defaultWorkbook.id,
      name: 'Prospects',
      position: await db.table.count({ where: { workbookId: defaultWorkbook.id } }),
    },
  });
  const activeTag = await db.tag.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: 'Active' } },
    update: {},
    create: { workspaceId: workspace.id, name: 'Active', color: '#22c55e' },
  });
  const sdrTag = await db.tag.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: 'SDR team' } },
    update: {},
    create: { workspaceId: workspace.id, name: 'SDR team', color: '#6366f1' },
  });
  await db.tagAssignment.createMany({
    data: [
      { tagId: activeTag.id, tableId: table.id },
      { tagId: sdrTag.id, tableId: table.id },
    ],
    skipDuplicates: true,
  });
  const columns = [
    { name: 'First name', type: 'text', kind: 'input', position: 0 },
    { name: 'Last name', type: 'text', kind: 'input', position: 1 },
    { name: 'Domain', type: 'url', kind: 'input', position: 2 },
    {
      name: 'Work email',
      type: 'email',
      kind: 'waterfall',
      config: {
        providers: [
          {
            provider: 'mock',
            action: 'mock.findEmail',
            input: {
              firstName: '{{First name}}',
              lastName: '{{Last name}}',
              domain: '{{Domain}}',
            },
          },
        ],
        accept: 'any',
      },
      position: 3,
    },
    {
      name: 'AI summary',
      type: 'text',
      kind: 'agent',
      config: {
        prompt: 'Summarize {{First name}} {{Last name}} at {{Domain}}',
        outputFields: { summary: 'string' },
      },
      position: 4,
    },
    {
      name: 'Display name',
      type: 'text',
      kind: 'formula',
      config: { expression: 'concat({{First name}}, " ", {{Last name}})' },
      position: 5,
    },
  ] as const;
  for (const column of columns) {
    await db.column.create({ data: { tableId: table.id, config: {}, ...column } });
  }
  const createdColumns: SeedColumn[] = await db.column.findMany({
    where: { tableId: table.id },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, kind: true },
  });
  const requestedRows = Number(
    process.argv.find((argument) => argument.startsWith('--rows='))?.split('=')[1] ?? people.length,
  );
  for (let position = 0; position < requestedRows; position += 1) {
    const person = people[position % people.length]!;
    const row = await db.row.create({ data: { tableId: table.id, position } });
    const values: Record<string, string> = {
      'First name': person[0],
      'Last name': person[1],
      Domain: person[2],
    };
    await db.$transaction(
      createdColumns.map((column) => {
        const value = values[column.name];
        return db.cell.create({
          data:
            value === undefined
              ? {
                  rowId: row.id,
                  columnId: column.id,
                  status: column.kind === 'input' ? 'done' : 'queued',
                }
              : { rowId: row.id, columnId: column.id, value, status: 'done' },
        });
      }),
    );
  }
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  const queue = new Queue('cells', { connection: redis });
  const runnableColumns = createdColumns.filter((column) =>
    ['waterfall', 'formula', 'agent'].includes(column.kind),
  );
  const rows = await db.row.findMany({ where: { tableId: table.id }, select: { id: true } });
  for (const row of rows) {
    for (const column of runnableColumns) {
      await queue.add('cell', {
        rowId: row.id,
        columnId: column.id,
        workspaceId: workspace.id,
      });
    }
  }
  await queue.close();
  await redis.quit();

  const importedContacts = [];
  for (const person of people) {
    const company = await db.company.upsert({
      where: {
        workspaceId_domainKey: { workspaceId: workspace.id, domainKey: person[2].toLowerCase() },
      },
      update: {
        name: person[3],
        domain: person[2],
        data: { industry: person[2].includes('ai') ? 'AI' : 'Technology' },
      },
      create: {
        workspaceId: workspace.id,
        name: person[3],
        domain: person[2],
        domainKey: person[2].toLowerCase(),
        data: { industry: person[2].includes('ai') ? 'AI' : 'Technology', employees: 250 },
      },
    });
    const contact = await db.contact.upsert({
      where: {
        workspaceId_emailKey: {
          workspaceId: workspace.id,
          emailKey: `${person[0]}.${person[1]}@${person[2]}`.toLowerCase(),
        },
      },
      update: {
        firstName: person[0],
        lastName: person[1],
        companyId: company.id,
        data: { title: 'VP Engineering' },
      },
      create: {
        workspaceId: workspace.id,
        email: `${person[0]}.${person[1]}@${person[2]}`.toLowerCase(),
        emailKey: `${person[0]}.${person[1]}@${person[2]}`.toLowerCase(),
        firstName: person[0],
        lastName: person[1],
        companyId: company.id,
        data: { title: 'VP Engineering' },
      },
    });
    importedContacts.push(contact);
  }
  const segment = await db.segment.upsert({
    where: { id: `${workspace.id}-ai-companies` },
    update: {
      name: 'AI companies',
      filter: { field: 'company.domain', op: 'contains', value: 'ai' },
    },
    create: {
      id: `${workspace.id}-ai-companies`,
      workspaceId: workspace.id,
      name: 'AI companies',
      filter: { field: 'company.domain', op: 'contains', value: 'ai' },
    },
  });
  await db.segmentMembership.deleteMany({ where: { segmentId: segment.id } });
  const aiContacts = importedContacts.filter((contact) => {
    const company = people.find(
      (person) => `${person[0]}.${person[1]}@${person[2]}`.toLowerCase() === contact.email,
    );
    return company?.[2].includes('ai');
  });
  await db.segmentMembership.createMany({
    data: aiContacts.map((contact) => ({ segmentId: segment.id, contactId: contact.id })),
  });

  await db.signalEvent.deleteMany({ where: { definition: { workspaceId: workspace.id } } });
  await db.signalDefinition.deleteMany({
    where: { workspaceId: workspace.id, name: 'Mock job changes' },
  });
  const signal = await db.signalDefinition.create({
    data: {
      workspaceId: workspace.id,
      name: 'Mock job changes',
      type: 'job_change',
      config: { provider: 'mock', action: 'mock.jobChanges', schedule: 'daily' },
      secret: randomBytes(24).toString('hex'),
    },
  });
  await db.signalEvent.createMany({
    data: importedContacts.slice(0, 5).map((contact, index) => ({
      definitionId: signal.id,
      dedupeKey: `seed:contact:${contact.id}`,
      contactId: contact.id,
      payload: { type: 'job_change', title: `VP Engineering ${index + 1}`, source: 'mock' },
      occurredAt: new Date(Date.now() - index * 86_400_000),
    })),
  });
  const oldWorkflow = await db.workflow.findFirst({
    where: { workspaceId: workspace.id, name: 'Job-change → enrich → append to table' },
  });
  if (oldWorkflow) await db.workflow.delete({ where: { id: oldWorkflow.id } });
  const workflow = await db.workflow.create({
    data: {
      workspaceId: workspace.id,
      name: 'Job-change → enrich → append to table',
      graph: {
        nodes: [
          {
            id: 'trigger',
            type: 'trigger.signal',
            config: { definitionId: signal.id },
            position: { x: 40, y: 80 },
          },
          {
            id: 'enrich',
            type: 'enrich',
            config: {
              provider: 'mock',
              action: 'mock.enrichPerson',
              input: {
                firstName: '{{trigger.firstName}}',
                lastName: '{{trigger.lastName}}',
                domain: '{{trigger.domain}}',
              },
            },
            position: { x: 260, y: 80 },
          },
          {
            id: 'condition',
            type: 'condition',
            config: { expression: '{{enrich.output.title}} contains "Engineer"' },
            position: { x: 480, y: 80 },
          },
          {
            id: 'append',
            type: 'table.appendRow',
            config: {
              tableId: table.id,
              values: {
                'Work email': '{{enrich.output.email}}',
                'Display name': '{{enrich.output.fullName}}',
              },
            },
            position: { x: 700, y: 20 },
          },
          {
            id: 'webhook',
            type: 'webhook.out',
            config: {
              url: 'http://localhost:4000/health',
              body: { title: '{{enrich.output.title}}' },
            },
            position: { x: 700, y: 180 },
          },
        ],
        edges: [
          { from: 'trigger', to: 'enrich' },
          { from: 'enrich', to: 'condition' },
          { from: 'condition', to: 'append', condition: 'true' },
          { from: 'condition', to: 'webhook', condition: 'false' },
        ],
      },
    },
  });
  const run = await db.workflowRun.create({
    data: {
      workflowId: workflow.id,
      input: {
        signalId: signal.id,
        firstName: 'Ada',
        lastName: 'Lovelace',
        domain: 'analytical.engine',
      },
    },
  });
  const workflowRunner = await import('../../../apps/worker/src/workflows');
  await workflowRunner.executeWorkflowRun(run.id, workspace.id);
  await workflowRunner.closeWorkflowResources();
  const previousSequence = await db.sequence.findFirst({
    where: { workspaceId: workspace.id, name: 'Signal follow-up sequence' },
    select: { id: true },
  });
  await db.campaign.deleteMany({
    where: {
      workspaceId: workspace.id,
      OR: [
        { name: 'Signal follow-up campaign' },
        ...(previousSequence ? [{ sequenceId: previousSequence.id }] : []),
      ],
    },
  });
  await db.sequence.deleteMany({
    where: { workspaceId: workspace.id, name: 'Signal follow-up sequence' },
  });
  await db.inbox.deleteMany({ where: { workspaceId: workspace.id, name: 'Demo mock inbox' } });
  const inbox = await db.inbox.create({
    data: {
      workspaceId: workspace.id,
      name: 'Demo mock inbox',
      config: { provider: 'mock', from: 'demo@gtmai.dev' },
    },
  });
  const sequence = await db.sequence.create({
    data: {
      workspaceId: workspace.id,
      inboxId: inbox.id,
      name: 'Signal follow-up sequence',
      steps: {
        create: [
          {
            position: 1,
            delayHours: 0,
            subjectTemplate: 'Quick idea for {{company.name}}',
            bodyTemplate: 'Hi {{contact.firstName}}, noticed {{company.name}} is growing.',
          },
          {
            position: 2,
            delayHours: 24,
            subjectTemplate: 'Following up, {{contact.firstName}}',
            bodyTemplate: 'Would a short conversation be useful?',
          },
        ],
      },
    },
    include: { steps: true },
  });
  const campaign = await db.campaign.create({
    data: {
      workspaceId: workspace.id,
      sequenceId: sequence.id,
      name: 'Signal follow-up campaign',
      status: 'active',
      enrollments: {
        create: importedContacts
          .slice(0, 3)
          .map((contact) => ({ contactId: contact.id, status: 'active' })),
      },
    },
    include: { enrollments: true },
  });
  const firstMessage = await db.message.create({
    data: {
      enrollmentId: campaign.enrollments[0]!.id,
      direction: 'outbound',
      subject: 'Quick idea',
      body: 'Hello',
      status: 'sent',
      sentAt: new Date(),
      stepPosition: 1,
    },
  });
  const repliedMessage = await db.message.create({
    data: {
      enrollmentId: campaign.enrollments[1]!.id,
      direction: 'outbound',
      subject: 'Quick idea',
      body: 'Hello',
      status: 'sent',
      sentAt: new Date(),
      stepPosition: 1,
    },
  });
  await db.reply.create({
    data: {
      messageId: repliedMessage.id,
      body: 'Interested — tell me more!',
      receivedAt: new Date(),
    },
  });
  await db.enrollment.update({
    where: { id: campaign.enrollments[1]!.id },
    data: { status: 'replied' },
  });
  void firstMessage;
  await db.adAudience.deleteMany({
    where: { workspaceId: workspace.id, name: 'Demo synced audience' },
  });
  const adAudience = await db.adAudience.create({
    data: {
      workspaceId: workspace.id,
      name: 'Demo synced audience',
      segmentId: segment.id,
      config: { segmentId: segment.id },
      platforms: ['mock'],
    },
  });
  await db.adPlatformSync.create({
    data: {
      audienceId: adAudience.id,
      platform: 'mock',
      status: 'synced',
      matched: aiContacts.length,
      uploaded: aiContacts.length,
      externalId: 'mock-seeded',
      syncedAt: new Date(),
    },
  });
  await db.crmSyncJob.deleteMany({
    where: { workspaceId: workspace.id, name: 'Demo CRM mock sync' },
  });
  const crmJob = await db.crmSyncJob.create({
    data: {
      workspaceId: workspace.id,
      name: 'Demo CRM mock sync',
      source: { kind: 'segment', id: segment.id },
      destination: {
        provider: 'mock',
        object: 'contact',
        fieldMapping: { email: 'email', firstname: 'firstName' },
        upsertKey: 'email',
      },
      lastRunAt: new Date(),
      lastStats: { matched: aiContacts.length, synced: aiContacts.length, skipped: 0 },
    },
  });
  if (aiContacts[0])
    await db.crmSyncRecord.create({
      data: {
        workspaceId: workspace.id,
        jobId: crmJob.id,
        externalKey: aiContacts[0].email ?? aiContacts[0].id,
        data: { email: aiContacts[0].email, firstname: aiContacts[0].firstName },
      },
    });
  await db.crmSyncRun.create({
    data: {
      jobId: crmJob.id,
      status: 'completed',
      stats: { matched: aiContacts.length, synced: aiContacts.length, skipped: 0 },
      startedAt: new Date(Date.now() - 60_000),
      completedAt: new Date(),
    },
  });
  await db.apiKey.deleteMany({ where: { workspaceId: workspace.id, name: 'Seed CLI key' } });
  const seededKey = `gtm_${randomBytes(24).toString('base64url')}`;
  await db.apiKey.create({
    data: {
      workspaceId: workspace.id,
      name: 'Seed CLI key',
      prefix: seededKey.slice(0, 12),
      hash: createHash('sha256').update(seededKey).digest('hex'),
    },
  });
  console.log(`Seed API key (shown once): ${seededKey}`);
  await db.creditBudget.upsert({
    where: {
      workspaceId_scope_period: { workspaceId: workspace.id, scope: 'workspace', period: 'daily' },
    },
    update: { limit: 500 },
    create: { workspaceId: workspace.id, scope: 'workspace', period: 'daily', limit: 500 },
  });
  await db.usageSnapshot.deleteMany({ where: { workspaceId: workspace.id, tableId: null } });
  await db.usageSnapshot.create({
    data: { workspaceId: workspace.id, period: new Date(), credits: 0 },
  });
  const oldFunction = await db.function.findFirst({
    where: { workspaceId: workspace.id, name: 'Normalize company name' },
  });
  if (oldFunction) await db.function.delete({ where: { id: oldFunction.id } });
  const fn = await db.function.create({
    data: { workspaceId: workspace.id, name: 'Normalize company name' },
  });
  await db.functionVersion.create({
    data: {
      functionId: fn.id,
      version: 1,
      program: {
        inputs: [{ name: 'name', type: 'text' }],
        nodes: [
          {
            id: 'trim',
            type: 'formula',
            config: { expression: 'trim({{inputs.name}})' },
            position: { x: 100, y: 80 },
          },
          {
            id: 'lower',
            type: 'formula',
            config: { expression: 'lower({{trim.output}})' },
            position: { x: 360, y: 80 },
          },
        ],
        output: '{{lower.output}}',
      },
      testCases: [
        { input: { name: '  Acme  ' }, expected: 'acme' },
        { input: { name: '  Globex  ' }, expected: 'globex' },
      ],
    },
  });
}

main().finally(() => db.$disconnect());
