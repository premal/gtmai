import { createCipheriv, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
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
  const workspace = await db.workspace.create({
    data: {
      name: 'Demo Workspace',
      users: { create: { userId: user.id, role: 'owner' } },
    },
  });
  await db.connection.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      provider: 'mock',
      name: 'Mock Provider',
      encryptedCredentials: encrypt({ apiKey: 'demo-mock-key' }),
    },
  });
  const table = await db.table.create({ data: { workspaceId: workspace.id, name: 'Prospects' } });
  const columns = [
    { name: 'First name', type: 'text', kind: 'input', position: 0 },
    { name: 'Last name', type: 'text', kind: 'input', position: 1 },
    { name: 'Domain', type: 'url', kind: 'input', position: 2 },
    {
      name: 'Work email',
      type: 'email',
      kind: 'waterfall',
      config: { providers: [{ provider: 'mock', action: 'mock.findEmail' }], accept: 'email' },
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
  const createdColumns = await db.column.findMany({
    where: { tableId: table.id },
    orderBy: { position: 'asc' },
  });
  for (const [position, person] of people.entries()) {
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
              ? { rowId: row.id, columnId: column.id, status: 'queued' }
              : { rowId: row.id, columnId: column.id, value, status: 'done' },
        });
      }),
    );
  }
}

main().finally(() => db.$disconnect());
