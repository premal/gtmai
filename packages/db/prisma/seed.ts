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
}

main().finally(() => db.$disconnect());
