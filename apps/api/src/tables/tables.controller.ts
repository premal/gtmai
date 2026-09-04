import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { FastifyRequest } from 'fastify';
import { Prisma } from '@gtmai/db';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

const tableBody = z.object({ name: z.string().min(1) });
const columnBody = z.object({
  name: z.string().min(1),
  type: z.enum(['text', 'number', 'boolean', 'date', 'url', 'email', 'json']),
  kind: z.enum(['input', 'enrichment', 'waterfall', 'agent', 'formula', 'http', 'function']),
  config: z.unknown().default({}),
});
type Request = FastifyRequest & { user: AuthUser };

@Controller('tables')
@UseGuards(JwtAuthGuard)
export class TablesController {
  constructor(
    private readonly prisma: PrismaService,
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
    return this.prisma.column.create({
      data: {
        tableId,
        name: input.name,
        type: input.type,
        kind: input.kind,
        config: input.config as Prisma.InputJsonValue,
        position,
      },
    });
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
              ? { rowId: row.id, columnId: column.id, status: 'queued' }
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

  @Post(':id/columns/:columnId/run')
  async runColumn(
    @Param('id') tableId: string,
    @Param('columnId') columnId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const input = z
      .object({ rowIds: z.array(z.string()).optional(), onlyEmpty: z.boolean().default(false) })
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
      if (input.onlyEmpty) {
        const cell = await this.prisma.cell.findUnique({
          where: { rowId_columnId: { rowId: row.id, columnId } },
        });
        if (cell?.value !== null && cell?.value !== undefined) continue;
      }
      await this.queue.add('cell', {
        rowId: row.id,
        columnId,
        workspaceId: request.user.workspaceId,
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
    }
    return { queued: columns.length };
  }
}
