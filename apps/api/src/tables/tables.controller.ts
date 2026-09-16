import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { Prisma } from '@gtmai/db';
import { providers, runAgent } from '@gtmai/providers';
import { builtInTemplates, resolveBindingsDeep } from '@gtmai/shared';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { decryptCredentials } from '../common/crypto';
import { debitCredits } from '../common/credits';
import { PrismaService } from '../prisma/prisma.service';
import { instantiateTableTemplate, type TableTemplateDefinition } from '../templates/instantiate';
import { createRowWithValues } from './row-helper';

const tableBody = z.object({ name: z.string().min(1) });
const columnBody = z.object({
  name: z.string().min(1),
  type: z.enum(['text', 'number', 'boolean', 'date', 'url', 'email', 'json']),
  kind: z.enum(['input', 'enrichment', 'waterfall', 'agent', 'formula', 'http', 'function']),
  config: z.unknown().default({}),
  runCondition: z.string().optional(),
  colorLabel: z.string().optional(),
});
type Request = FastifyRequest & { user: AuthUser };
type MultipartRequest = Request & {
  isMultipart: () => boolean;
  file: () => Promise<MultipartFile | undefined>;
};

@Controller('tables')
@UseGuards(JwtAuthGuard)
export class TablesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @InjectQueue('cells') private readonly queue: Queue,
  ) {}

  @Get()
  list(@Req() request: Request) {
    return this.prisma.table.findMany({
      where: { workspaceId: request.user.workspaceId },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { rows: true, columns: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() request: Request) {
    const table = await this.prisma.table.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
      include: {
        columns: { orderBy: { position: 'asc' } },
        rows: { orderBy: { position: 'asc' }, include: { cells: true } },
      },
    });
    if (!table) throw new Error('Table not found');
    return table;
  }

  @Patch(':id')
  rename(@Param('id') id: string, @Body() body: unknown, @Req() request: Request) {
    const input = tableBody.parse(body);
    return this.prisma.table.updateMany({
      where: { id, workspaceId: request.user.workspaceId },
      data: { name: input.name },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() request: Request) {
    await this.prisma.table.deleteMany({ where: { id, workspaceId: request.user.workspaceId } });
    return { ok: true };
  }

  @Post(':id/columns')
  async addColumn(@Param('id') tableId: string, @Body() body: unknown, @Req() request: Request) {
    const input = columnBody.parse(body);
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId: request.user.workspaceId },
    });
    if (!table) throw new Error('Table not found');
    const position = await this.prisma.column.count({ where: { tableId } });
    const data: Prisma.ColumnUncheckedCreateInput = {
      tableId,
      name: input.name,
      type: input.type,
      kind: input.kind,
      config: input.config as Prisma.InputJsonValue,
      position,
    };
    if (input.runCondition !== undefined) data.runCondition = input.runCondition;
    if (input.colorLabel !== undefined) data.colorLabel = input.colorLabel;
    return this.prisma.column.create({
      data,
    });
  }

  @Patch(':id/columns/:columnId')
  async updateColumn(
    @Param('id') tableId: string,
    @Param('columnId') columnId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const input = columnBody.partial().parse(body);
    const column = await this.prisma.column.findFirst({
      where: { id: columnId, tableId, table: { workspaceId: request.user.workspaceId } },
    });
    if (!column) throw new Error('Column not found');
    const data: Prisma.ColumnUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.type !== undefined) data.type = input.type;
    if (input.kind !== undefined) data.kind = input.kind;
    if (input.config !== undefined) data.config = input.config as Prisma.InputJsonValue;
    if (input.runCondition !== undefined) data.runCondition = input.runCondition;
    if (input.colorLabel !== undefined) data.colorLabel = input.colorLabel;
    return this.prisma.column.update({ where: { id: columnId }, data });
  }

  @Delete(':id/columns/:columnId')
  async deleteColumn(
    @Param('id') tableId: string,
    @Param('columnId') columnId: string,
    @Req() request: Request,
  ) {
    await this.prisma.column.deleteMany({
      where: { id: columnId, tableId, table: { workspaceId: request.user.workspaceId } },
    });
    return { ok: true };
  }

  @Post(':id/rows')
  async addRow(@Param('id') tableId: string, @Body() body: unknown, @Req() request: Request) {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId: request.user.workspaceId },
    });
    if (!table) throw new Error('Table not found');
    const input = z.object({ values: z.record(z.unknown()).default({}) }).parse(body);
    const position = await this.prisma.row.count({ where: { tableId } });
    const columns = await this.prisma.column.findMany({ where: { tableId } });
    const values = Object.fromEntries(
      columns.map((column) => [column.id, input.values[column.name]]),
    );
    return createRowWithValues(this.prisma, tableId, columns, values, position);
  }

  @Post(':id/source')
  async importSource(@Param('id') tableId: string, @Body() body: unknown, @Req() request: Request) {
    const input = z
      .object({
        provider: z.string().min(1),
        action: z.string().min(1),
        input: z.record(z.unknown()),
        mapping: z.record(z.string()).optional(),
      })
      .parse(body);
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId: request.user.workspaceId },
      include: { columns: true },
    });
    if (!table) throw new Error('Table not found');
    const provider = providers.find((item) => item.id === input.provider);
    const action = provider?.actions.find((item) => item.id === input.action);
    if (!provider || !action || action.category !== 'search') {
      throw new Error(`Unknown search action: ${input.provider}/${input.action}`);
    }
    const connection = await this.prisma.connection.findFirst({
      where: { workspaceId: request.user.workspaceId, provider: input.provider },
    });
    if (!connection)
      throw new Error(`No connection for ${input.provider} — add one in Connections`);
    const result = await action.run(input.input, {
      credentials: decryptCredentials(connection.encryptedCredentials),
      fetch,
      logger: { info: () => undefined, error: () => undefined },
    });
    if (!result.found) throw new Error(result.reason ?? 'Source search failed');
    const data = result.data as {
      companies?: Record<string, unknown>[];
      total?: number;
    };
    const companies = Array.isArray(data.companies) ? data.companies : [];
    const defaults: Record<string, string> = {
      Company: 'name',
      Domain: 'domain',
      Industry: 'industry',
      Employees: 'employees',
      Country: 'country',
    };
    const mapping = input.mapping ?? {};
    const columns = table.columns;
    const position = await this.prisma.row.count({ where: { tableId } });
    for (const [index, company] of companies.entries()) {
      const values = Object.fromEntries(
        columns.map((column) => {
          const sourceKey = mapping[column.name] ?? defaults[column.name];
          return [column.id, sourceKey ? company[sourceKey] : undefined];
        }),
      );
      await createRowWithValues(this.prisma, tableId, columns, values, position + index);
    }
    return { imported: companies.length, total: data.total ?? companies.length };
  }

  @Post(':id/fanout')
  async fanout(@Param('id') tableId: string, @Body() body: unknown, @Req() request: Request) {
    const input = z
      .object({
        provider: z.string().min(1),
        action: z.string().min(1),
        input: z.record(z.unknown()),
        rowIds: z.array(z.string()).optional(),
        carry: z.array(z.string()).default([]),
        target: z.object({ tableId: z.string().optional(), name: z.string().optional() }),
      })
      .parse(body);
    const source = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId: request.user.workspaceId },
      include: {
        columns: true,
        rows: { orderBy: { position: 'asc' }, include: { cells: { include: { column: true } } } },
      },
    });
    if (!source) throw new Error('Table not found');
    const provider = providers.find((item) => item.id === input.provider);
    const action = provider?.actions.find((item) => item.id === input.action);
    if (!provider || !action || action.category !== 'search' || action.sourceKind !== 'people') {
      throw new Error(`Unknown people search action: ${input.provider}/${input.action}`);
    }
    const connection = await this.prisma.connection.findFirst({
      where: { workspaceId: request.user.workspaceId, provider: input.provider },
    });
    if (!connection) {
      throw new Error(`No connection for ${input.provider} — add one in Connections`);
    }
    const targetTemplate = builtInTemplates.find((item) => item.id === 'builtin-people-outreach');
    if (!input.target.tableId && !targetTemplate) throw new Error('People template not found');
    const target = input.target.tableId
      ? await this.prisma.table.findFirst({
          where: { id: input.target.tableId, workspaceId: request.user.workspaceId },
        })
      : (
          await instantiateTableTemplate(
            this.prisma,
            request.user.workspaceId,
            input.target.name ?? `${source.name} — people`,
            targetTemplate?.definition as unknown as TableTemplateDefinition,
          )
        ).table;
    if (!target) throw new Error('Target table not found');
    let targetColumns = await this.prisma.column.findMany({
      where: { tableId: target.id },
      orderBy: { position: 'asc' },
    });
    const required = [
      'First name',
      'Last name',
      'Title',
      'Seniority',
      'Department',
      'LinkedIn',
      'Email',
      'Company',
      'Domain',
    ];
    for (const name of [...required, ...input.carry]) {
      if (targetColumns.some((column) => column.name === name)) continue;
      const position = targetColumns.length;
      const created = await this.prisma.column.create({
        data: { tableId: target.id, name, type: 'text', kind: 'input', config: {}, position },
      });
      targetColumns = [...targetColumns, created];
    }
    const rows = input.rowIds
      ? source.rows.filter((row) => input.rowIds?.includes(row.id))
      : source.rows;
    const credentials = decryptCredentials(connection.encryptedCredentials);
    let imported = 0;
    const errors: { rowId: string; message: string }[] = [];
    let position = await this.prisma.row.count({ where: { tableId: target.id } });
    for (const row of rows) {
      const sourceValues = Object.fromEntries(
        row.cells.map((cell) => [cell.column.name, cell.value]),
      );
      try {
        const result = await action.run(resolveBindingsDeep(input.input, sourceValues), {
          credentials,
          fetch,
          logger: { info: () => undefined, error: () => undefined },
        });
        if (!result.found) throw new Error(result.reason ?? 'People search failed');
        const people = Array.isArray((result.data as { people?: unknown[] }).people)
          ? ((result.data as { people: unknown[] }).people ?? [])
          : [];
        for (const personValue of people) {
          const person = personValue as Record<string, unknown>;
          const company =
            person.company && typeof person.company === 'object'
              ? (person.company as Record<string, unknown>)
              : {};
          const valuesByName: Record<string, unknown> = {
            'First name': person.firstName,
            'Last name': person.lastName,
            Title: person.title,
            Seniority: person.seniority,
            Department: person.department,
            LinkedIn: person.linkedinUrl,
            Email: person.email,
            Company: company.name ?? sourceValues.Company,
            Domain: company.domain ?? sourceValues.Domain,
            ...Object.fromEntries(input.carry.map((name) => [name, sourceValues[name]])),
          };
          const values = Object.fromEntries(
            targetColumns.map((column) => [column.id, valuesByName[column.name]]),
          );
          await createRowWithValues(this.prisma, target.id, targetColumns, values, position++);
          imported += 1;
        }
        await debitCredits(this.prisma, {
          workspaceId: request.user.workspaceId,
          tableId: target.id,
          provider: input.provider,
          credits: action.creditCost,
          reason: 'people fanout',
          refType: 'fanout',
          refId: row.id,
        });
      } catch (error) {
        errors.push({
          rowId: row.id,
          message: error instanceof Error ? error.message : 'People search failed',
        });
      }
    }
    return { tableId: target.id, imported, sourceRows: rows.length, errors };
  }

  @Post(':id/import')
  async importCsv(
    @Param('id') tableId: string,
    @Body() body: unknown,
    @Req() request: MultipartRequest,
  ) {
    const jsonBody = z
      .object({ csv: z.string().optional(), mapping: z.record(z.string()).optional() })
      .parse(body ?? {});
    const upload = request.isMultipart() ? await request.file() : undefined;
    const uploadedCsv = upload ? (await upload.toBuffer()).toString('utf8') : undefined;
    const multipartMapping = upload?.fields.mapping;
    const mappingField =
      multipartMapping && !Array.isArray(multipartMapping) && multipartMapping.type === 'field'
        ? multipartMapping.value
        : undefined;
    const mapping =
      jsonBody.mapping ??
      (typeof mappingField === 'string'
        ? z.record(z.string()).parse(JSON.parse(mappingField))
        : undefined) ??
      {};
    const csv = uploadedCsv ?? jsonBody.csv;
    if (!csv) throw new Error('CSV content is required');
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId: request.user.workspaceId },
      include: { columns: true },
    });
    if (!table) throw new Error('Table not found');
    const lines = csv.trim().split(/\r?\n/);
    const parseLine = (line: string): string[] => {
      const values: string[] = [];
      let current = '';
      let quoted = false;
      for (const character of line) {
        if (character === '"') quoted = !quoted;
        else if (character === ',' && !quoted) {
          values.push(current.trim());
          current = '';
        } else current += character;
      }
      values.push(current.trim());
      return values.map((value) => value.replace(/^"|"$/g, '').replace(/""/g, '"'));
    };
    const sourceHeaders = parseLine(lines[0] ?? '');
    const headers = sourceHeaders.map((header) => mapping[header] || header);
    const columns = [...table.columns];
    for (const [position, name] of headers.entries()) {
      if (columns.some((column) => column.name === name)) continue;
      columns.push(
        await this.prisma.column.create({
          data: { tableId, name, type: 'text', kind: 'input', config: {}, position },
        }),
      );
    }
    for (const [position, line] of lines.slice(1).entries()) {
      if (!line.trim()) continue;
      const values = parseLine(line);
      const imported = new Map(headers.map((header, index) => [header, values[index] ?? '']));
      const row = await this.prisma.row.create({ data: { tableId, position } });
      await this.prisma.$transaction(
        columns.map((column) =>
          this.prisma.cell.create({
            data: {
              rowId: row.id,
              columnId: column.id,
              value: imported.has(column.name)
                ? (imported.get(column.name) as Prisma.InputJsonValue)
                : Prisma.JsonNull,
              status: 'done',
            },
          }),
        ),
      );
    }
    return { rows: Math.max(0, lines.length - 1), columns: headers.length };
  }

  @Get(':id/export')
  async exportCsv(@Param('id') tableId: string, @Req() request: Request) {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId: request.user.workspaceId },
      include: { columns: true, rows: { include: { cells: true }, orderBy: { position: 'asc' } } },
    });
    if (!table) throw new Error('Table not found');
    const escape = (value: unknown): string => {
      const text =
        typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
      return `"${text.replace(/"/g, '""')}"`;
    };
    const lines = [
      table.columns.map((column) => escape(column.name)).join(','),
      ...table.rows.map((row) =>
        table.columns
          .map((column) => escape(row.cells.find((cell) => cell.columnId === column.id)?.value))
          .join(','),
      ),
    ];
    return { csv: lines.join('\n') };
  }

  @Patch(':id/rows/:rowId')
  async updateRow(
    @Param('id') tableId: string,
    @Param('rowId') rowId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const input = z.object({ values: z.record(z.unknown()) }).parse(body);
    const row = await this.prisma.row.findFirst({
      where: { id: rowId, tableId, table: { workspaceId: request.user.workspaceId } },
      include: { cells: { include: { column: true } } },
    });
    if (!row) throw new Error('Row not found');
    for (const cell of row.cells) {
      if (!(cell.column.name in input.values)) continue;
      const value = input.values[cell.column.name];
      await this.prisma.cell.update({
        where: { id: cell.id },
        data: { value: value as Prisma.InputJsonValue, status: 'done', error: null },
      });
    }
    return this.prisma.row.findUnique({ where: { id: rowId }, include: { cells: true } });
  }

  @Delete(':id/rows/:rowId')
  async deleteRow(
    @Param('id') tableId: string,
    @Param('rowId') rowId: string,
    @Req() request: Request,
  ) {
    await this.prisma.row.deleteMany({
      where: { id: rowId, tableId, table: { workspaceId: request.user.workspaceId } },
    });
    return { ok: true };
  }

  @Post(':id/rows/delete')
  async deleteRows(@Param('id') tableId: string, @Body() body: unknown, @Req() request: Request) {
    const input = z.object({ rowIds: z.array(z.string()).min(1) }).parse(body);
    await this.prisma.row.deleteMany({
      where: {
        id: { in: input.rowIds },
        tableId,
        table: { workspaceId: request.user.workspaceId },
      },
    });
    return { ok: true };
  }

  @Post(':id/columns/:columnId/run')
  async runColumn(
    @Param('id') tableId: string,
    @Param('columnId') columnId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const input = z
      .object({
        rowIds: z.array(z.string()).optional(),
        onlyEmpty: z.boolean().default(false),
        onlyErrored: z.boolean().default(false),
      })
      .parse(body);
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId: request.user.workspaceId },
    });
    if (!table) throw new Error('Table not found');
    const rows = await this.prisma.row.findMany({
      where: input.rowIds ? { tableId, id: { in: input.rowIds } } : { tableId },
    });
    let queued = 0;
    for (const row of rows) {
      if (input.onlyEmpty || input.onlyErrored) {
        const cell = await this.prisma.cell.findUnique({
          where: { rowId_columnId: { rowId: row.id, columnId } },
        });
        if (input.onlyEmpty && cell?.value !== null && cell?.value !== undefined) continue;
        if (input.onlyErrored && cell?.status !== 'error') continue;
      }
      await this.prisma.cell.upsert({
        where: { rowId_columnId: { rowId: row.id, columnId } },
        create: { rowId: row.id, columnId, status: 'queued' },
        update: { status: 'queued', error: null },
      });
      await this.queue.add(
        'cell',
        {
          rowId: row.id,
          columnId,
          workspaceId: request.user.workspaceId,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 10_000 } },
      );
      queued += 1;
    }
    return { queued };
  }

  @Post(':id/rows/:rowId/run')
  async runRow(
    @Param('id') tableId: string,
    @Param('rowId') rowId: string,
    @Req() request: Request,
  ) {
    const columns = await this.prisma.column.findMany({
      where: { tableId, table: { workspaceId: request.user.workspaceId } },
    });
    for (const column of columns) {
      await this.prisma.cell.upsert({
        where: { rowId_columnId: { rowId, columnId: column.id } },
        create: { rowId, columnId: column.id, status: 'queued' },
        update: { status: 'queued', error: null },
      });
      await this.queue.add(
        'cell',
        {
          rowId,
          columnId: column.id,
          workspaceId: request.user.workspaceId,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 10_000 } },
      );
    }
    return { queued: columns.length };
  }

  @Post(':id/columns/:columnId/preview')
  async previewAgent(
    @Param('id') tableId: string,
    @Param('columnId') columnId: string,
    @Req() request: Request,
  ) {
    const column = await this.prisma.column.findFirst({
      where: { id: columnId, tableId, table: { workspaceId: request.user.workspaceId } },
    });
    if (!column || column.kind !== 'agent') throw new Error('Agent column not found');
    const config = column.config as Record<string, unknown>;
    const provider = config.provider === 'anthropic' ? 'anthropic' : 'openai';
    const connection = await this.prisma.connection.findFirst({
      where: { workspaceId: request.user.workspaceId, provider: { in: [provider, 'llm'] } },
    });
    if (!connection) {
      return {
        previews: [
          { error: `No connection for ${provider} — add one in Connections` },
          { error: `No connection for ${provider} — add one in Connections` },
          { error: `No connection for ${provider} — add one in Connections` },
        ],
      };
    }
    const rows = await this.prisma.row.findMany({
      where: { tableId },
      orderBy: { position: 'asc' },
      take: 3,
      include: { cells: { include: { column: true } } },
    });
    const credentials = decryptCredentials(connection.encryptedCredentials);
    const previews = [];
    for (const row of rows) {
      const values = Object.fromEntries(row.cells.map((cell) => [cell.column.name, cell.value]));
      const prompt = String(config.prompt ?? '').replace(
        /\{\{([^}]+)\}\}/g,
        (_match, name: string) => String(values[name.trim()] ?? ''),
      );
      try {
        const result = await runAgent(
          prompt,
          {
            credentials,
            fetch,
            logger: { info: () => undefined, error: () => undefined },
          },
          provider,
          typeof config.model === 'string' ? config.model : undefined,
        );
        previews.push({ rowId: row.id, value: result });
      } catch (error) {
        previews.push({
          rowId: row.id,
          error: error instanceof Error ? error.message : 'Preview failed',
        });
      }
    }
    return { previews };
  }
}
