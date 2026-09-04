import { createCipheriv, randomBytes } from 'node:crypto';
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
  const table = await db.table.create({ data: { workspaceId: workspace.id, name: 'Prospects' } });
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
              firstName: '{{trigger.firstName}}',
            },
            position: { x: 320, y: 80 },
          },
          {
            id: 'append',
            type: 'table.appendRow',
            config: { tableId: table.id },
            position: { x: 620, y: 80 },
          },
        ],
        edges: [
          { from: 'trigger', to: 'enrich' },
          { from: 'enrich', to: 'append' },
        ],
      },
    },
  });
  const run = await db.workflowRun.create({
    data: {
      workflowId: workflow.id,
      status: 'done',
      input: { signalId: signal.id },
      output: { imported: true },
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });
  await db.stepRun.createMany({
    data: ['trigger', 'enrich', 'append'].map((nodeId) => ({
      workflowRunId: run.id,
      nodeId,
      status: 'done',
      input: {},
      output: {},
    })),
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
      program: { inputs: [{ name: 'name', type: 'text' }], nodes: [], output: '{{name}}' },
      testCases: [{ input: { name: '  Acme  ' }, expected: '  Acme  ' }],
    },
  });
}

main().finally(() => db.$disconnect());
