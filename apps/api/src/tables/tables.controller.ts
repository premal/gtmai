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
import { runAgent } from '@gtmai/providers';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { decryptCredentials } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';

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
    const row = await this.prisma.row.create({ data: { tableId, position } });
    const columns = await this.prisma.column.findMany({ where: { tableId } });
    await this.prisma.$transaction(
      columns.map((column) => {
        const value = input.values[column.name];
        return this.prisma.cell.create({
          data:
            value === undefined
              ? { rowId: row.id, columnId: column.id, status: 'skipped' }
              : {
                  rowId: row.id,
                  columnId: column.id,
                  value: value as Prisma.InputJsonValue,
                  status: 'done',
                },
        });
      }),
    );
    return row;
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
    const mapping = jsonBody.mapping ?? {};
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
      await this.queue.add('cell', {
        rowId: row.id,
        columnId,
        workspaceId: request.user.workspaceId,
      });
      await this.prisma.cell.upsert({
        where: { rowId_columnId: { rowId: row.id, columnId } },
        create: { rowId: row.id, columnId, status: 'queued' },
        update: { status: 'queued', error: null },
      });
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
      await this.queue.add('cell', {
        rowId,
        columnId: column.id,
        workspaceId: request.user.workspaceId,
      });
      await this.prisma.cell.upsert({
        where: { rowId_columnId: { rowId, columnId: column.id } },
        create: { rowId, columnId: column.id, status: 'queued' },
        update: { status: 'queued', error: null },
      });
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
