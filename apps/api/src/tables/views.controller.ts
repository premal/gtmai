import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@gtmai/db';
import { filterSchema } from '@gtmai/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { assertWorkbookAccess } from '../common/workbook-access';
import { WorkbookResourceGuard } from '../common/workbook-resource.guard';
import type { ViewSort } from './view-helper';

type Request = FastifyRequest & { user: AuthUser };
const sortSchema = z.array(
  z.object({ columnId: z.string().min(1), direction: z.enum(['asc', 'desc']) }),
);
const viewBody = z.object({
  name: z.string().min(1).optional(),
  filter: filterSchema.nullable().optional(),
  sort: sortSchema.optional(),
  hiddenColumnIds: z.array(z.string()).optional(),
  position: z.number().int().min(0).optional(),
});

@Controller('tables/:tableId/views')
@UseGuards(JwtAuthGuard, WorkbookResourceGuard)
export class ViewsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Param('tableId') tableId: string, @Req() request: Request) {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId: request.user.workspaceId },
      select: { workbookId: true },
    });
    if (!table) throw new Error('Table not found');
    await assertWorkbookAccess(this.prisma, request.user, table.workbookId);
    return this.prisma.view.findMany({
      where: { tableId, table: { workspaceId: request.user.workspaceId } },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Post()
  async create(@Param('tableId') tableId: string, @Req() request: Request, @Body() body: unknown) {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId: request.user.workspaceId },
      select: { workbookId: true },
    });
    if (!table) throw new Error('Table not found');
    await assertWorkbookAccess(this.prisma, request.user, table.workbookId);
    const input = viewBody.required({ name: true }).parse(body);
    const columns = await this.getTableColumns(request.user.workspaceId, tableId);
    this.assertColumnReferences(columns, input.filter, input.sort, input.hiddenColumnIds);
    const position = input.position ?? (await this.prisma.view.count({ where: { tableId } }));
    const data: Prisma.ViewUncheckedCreateInput = {
      tableId,
      name: input.name,
      filter:
        input.filter === undefined ? Prisma.JsonNull : (input.filter as Prisma.InputJsonValue),
      sort: (input.sort ?? []) as Prisma.InputJsonValue,
      hiddenColumnIds: (input.hiddenColumnIds ?? []) as Prisma.InputJsonValue,
      position,
    };
    return this.prisma.view.create({ data });
  }

  @Patch(':viewId')
  async update(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    const tableAccess = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId: request.user.workspaceId },
      select: { workbookId: true },
    });
    if (!tableAccess) throw new Error('Table not found');
    await assertWorkbookAccess(this.prisma, request.user, tableAccess.workbookId);
    const input = viewBody.parse(body);
    const view = await this.prisma.view.findFirst({
      where: { id: viewId, tableId, table: { workspaceId: request.user.workspaceId } },
    });
    if (!view) throw new Error('View not found');
    const columns = await this.getTableColumns(request.user.workspaceId, tableId);
    this.assertColumnReferences(columns, input.filter, input.sort, input.hiddenColumnIds);
    const data: Prisma.ViewUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.filter !== undefined)
      data.filter =
        input.filter === null ? Prisma.JsonNull : (input.filter as Prisma.InputJsonValue);
    if (input.sort !== undefined) data.sort = input.sort as Prisma.InputJsonValue;
    if (input.hiddenColumnIds !== undefined)
      data.hiddenColumnIds = input.hiddenColumnIds as Prisma.InputJsonValue;
    if (input.position !== undefined) data.position = input.position;
    return this.prisma.view.update({ where: { id: viewId }, data });
  }

  @Delete(':viewId')
  async remove(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Req() request: Request,
  ) {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId: request.user.workspaceId },
      select: { workbookId: true },
    });
    if (!table) throw new Error('Table not found');
    await assertWorkbookAccess(this.prisma, request.user, table.workbookId);
    const result = await this.prisma.view.deleteMany({
      where: { id: viewId, tableId, table: { workspaceId: request.user.workspaceId } },
    });
    if (!result.count) throw new Error('View not found');
    return { ok: true };
  }

  @Post(':viewId/duplicate')
  async duplicate(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Req() request: Request,
  ) {
    const view = await this.prisma.view.findFirst({
      where: { id: viewId, tableId, table: { workspaceId: request.user.workspaceId } },
    });
    if (!view) throw new Error('View not found');
    return this.prisma.view.create({
      data: {
        tableId,
        name: `${view.name} copy`,
        filter: view.filter ?? Prisma.JsonNull,
        sort: view.sort as Prisma.InputJsonValue,
        hiddenColumnIds: view.hiddenColumnIds as Prisma.InputJsonValue,
        position: await this.prisma.view.count({ where: { tableId } }),
      },
    });
  }

  private async getTableColumns(workspaceId: string, tableId: string) {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId },
      select: { columns: { select: { id: true } } },
    });
    if (!table) throw new Error('Table not found');
    return table.columns;
  }

  private assertColumnReferences(
    columns: { id: string }[],
    filter: z.infer<typeof filterSchema> | null | undefined,
    sort: Array<{ columnId: string; direction: 'asc' | 'desc' }> | undefined,
    hiddenColumnIds: string[] | undefined,
  ) {
    const columnIds = new Set(columns.map((column) => column.id));
    const checkFilter = (value: typeof filter): void => {
      if (!value) return;
      if ('field' in value) {
        if (!columnIds.has(value.field)) throw new Error(`View column not found: ${value.field}`);
        return;
      }
      for (const child of [...(value.and ?? []), ...(value.or ?? [])]) checkFilter(child);
    };
    checkFilter(filter);
    for (const item of sort ?? []) {
      if (!columnIds.has(item.columnId)) throw new Error(`View column not found: ${item.columnId}`);
    }
    for (const columnId of hiddenColumnIds ?? []) {
      if (!columnIds.has(columnId)) throw new Error(`View column not found: ${columnId}`);
    }
  }
}
