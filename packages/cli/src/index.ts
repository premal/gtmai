#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Command } from 'commander';

type Config = { apiUrl: string; apiKey: string };
const configPath = join(homedir(), '.gtmai', 'config.json');
async function readConfig(): Promise<Config> {
  try {
    return JSON.parse(await readFile(configPath, 'utf8')) as Config;
  } catch {
    return { apiUrl: 'http://localhost:4000', apiKey: '' };
  }
}
async function saveConfig(config: Config) {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2));
}
async function request(path: string, init: RequestInit = {}) {
  const config = await readConfig();
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${config.apiKey}`, ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error((body as { message?: string }).message ?? `HTTP ${response.status}`);
  return body;
}
function output(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
const program = new Command().name('gtmai').description('GTM AI REST API CLI');
program
  .command('login')
  .requiredOption('--api-key <key>')
  .option('--url <url>', 'API URL', 'http://localhost:4000')
  .action(async (options: { apiKey: string; url: string }) => {
    await saveConfig({ apiKey: options.apiKey, apiUrl: options.url });
    output({ ok: true, config: configPath });
  });
const tables = program.command('tables');
tables.command('list').action(async () => output(await request('/tables')));
tables.command('get <id>').action(async (id: string) => output(await request(`/tables/${id}`)));
tables
  .command('run <id>')
  .action(async (id: string) => output(await request(`/tables/${id}/run`, { method: 'POST' })));
tables.command('import <id> <file>').action(async (id: string, file: string) => {
  const csv = await readFile(file);
  output(
    await request(`/tables/${id}/import`, {
      method: 'POST',
      body: csv,
      headers: { 'content-type': 'text/csv' },
    }),
  );
});
const audiences = program.command('audiences');
const contacts = audiences.command('contacts');
contacts
  .command('list')
  .option('-q, --query <query>')
  .action(async (options: { query?: string }) =>
    output(
      await request(
        `/audiences/contacts${options.query ? `?q=${encodeURIComponent(options.query)}` : ''}`,
      ),
    ),
  );
contacts
  .command('search <query>')
  .action(async (query: string) =>
    output(await request(`/audiences/contacts?q=${encodeURIComponent(query)}`)),
  );
const workflows = program.command('workflows');
workflows.command('list').action(async () => output(await request('/workflows')));
workflows.command('run <id>').action(async (id: string) =>
  output(
    await request(`/workflows/${id}/run`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    }),
  ),
);
const functions = program.command('functions');
functions.command('test <id>').action(async (id: string) =>
  output(
    await request(`/functions/${id}/test`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    }),
  ),
);
program
  .command('sequences')
  .command('list')
  .action(async () => output(await request('/sequences')));
await program.parseAsync();
