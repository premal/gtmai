#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
type Config = { apiUrl: string; apiKey: string };
async function config(): Promise<Config> {
  return JSON.parse(await readFile(join(homedir(), '.gtmai', 'config.json'), 'utf8')) as Config;
}
async function call(path: string, init: RequestInit = {}) {
  const settings = await config();
  const response = await fetch(`${settings.apiUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${settings.apiKey}`, ...(init.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error((body as { message?: string }).message ?? `HTTP ${response.status}`);
  return body;
}
const server = new McpServer({ name: 'gtmai', version: '0.1.0' });
server.tool('search_contacts', { query: z.string() }, async ({ query }) => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(await call(`/audiences/contacts?q=${encodeURIComponent(query)}`)),
    },
  ],
}));
server.tool('enrich_person', { email: z.string().email() }, async ({ email }) => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(
        await call('/formula/execute', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expression: email }),
        }),
      ),
    },
  ],
}));
server.tool('run_workflow', { workflowId: z.string() }, async ({ workflowId }) => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(
        await call(`/workflows/${workflowId}/run`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
      ),
    },
  ],
}));
server.tool('get_table_rows', { tableId: z.string() }, async ({ tableId }) => ({
  content: [{ type: 'text', text: JSON.stringify(await call(`/tables/${tableId}`)) }],
}));
server.tool(
  'enroll_in_campaign',
  { campaignId: z.string(), contactId: z.string() },
  async ({ campaignId, contactId }) => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          await call(`/campaigns`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: `MCP enrollment ${contactId}`,
              sequenceId: campaignId,
              contactIds: [contactId],
            }),
          }),
        ),
      },
    ],
  }),
);
await server.connect(new StdioServerTransport());
