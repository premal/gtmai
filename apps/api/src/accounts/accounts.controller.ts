import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@gtmai/db';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { assertWorkbookAccess } from '../common/workbook-access';
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };

const exploreQuery = z.object({
  q: z.string().optional(),
  industry: z.string().optional(),
  state: z.string().optional(),
  size: z.string().optional(),
  country: z.string().optional(),
  domain: z.string().optional(),
  hasDomain: z.enum(['true', 'false']).optional(),
  hasLinkedin: z.enum(['true', 'false']).optional(),
  minEmployees: z.coerce.number().optional(),
  maxEmployees: z.coerce.number().optional(),
  minRevenue: z.coerce.number().optional(),
  maxRevenue: z.coerce.number().optional(),
  sort: z.enum(['revenueUsdM', 'employees', 'name', 'domain', 'founded']).default('revenueUsdM'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(200).default(50),
});

const filtersQuery = exploreQuery.partial();
type ExploreInput = z.infer<typeof exploreQuery>;
type FiltersInput = z.infer<typeof filtersQuery>;

export function buildAccountWhere(input: FiltersInput): Prisma.AccountWhereInput {
  const where: Prisma.AccountWhereInput = {};
  const or: Prisma.AccountWhereInput[] = [];
  if (input.q) {
    for (const field of ['name', 'domain', 'linkedinUrl', 'ticker'] as const) {
      or.push({ [field]: { contains: input.q, mode: 'insensitive' } });
    }
  }
  if (input.domain) or.push({ domain: { contains: input.domain, mode: 'insensitive' } });
  if (or.length) where.OR = or;
  // industry/state/size accept comma-separated multi-select values
  if (input.industry) where.industry = { in: input.industry.split(','), mode: 'insensitive' };
  if (input.state) where.state = { in: input.state.split(','), mode: 'insensitive' };
  if (input.size) where.size = { in: input.size.split(',') };
  if (input.country) where.country = { equals: input.country, mode: 'insensitive' };
  if (input.hasDomain === 'true') where.domain = { not: null };
  if (input.hasDomain === 'false') where.domain = null;
  if (input.hasLinkedin === 'true') where.linkedinUrl = { not: null };
  if (input.hasLinkedin === 'false') where.linkedinUrl = null;
  const employees: Prisma.IntFilter = {};
  if (input.minEmployees !== undefined) employees.gte = input.minEmployees;
  if (input.maxEmployees !== undefined) employees.lte = input.maxEmployees;
  if (Object.keys(employees).length) where.employees = employees;
  const revenue: Prisma.FloatFilter = {};
  if (input.minRevenue !== undefined) revenue.gte = input.minRevenue;
  if (input.maxRevenue !== undefined) revenue.lte = input.maxRevenue;
  if (Object.keys(revenue).length) where.revenueUsdM = revenue;
  return where;
}

function buildOrderBy(input: ExploreInput): Prisma.AccountOrderByWithRelationInput {
  const dir = input.order;
  if (input.sort === 'revenueUsdM' || input.sort === 'employees' || input.sort === 'founded') {
    return { [input.sort]: { sort: dir, nulls: 'last' } };
  }
  return { [input.sort]: dir };
}

// Display name → Account field. Column type chosen for the grid.
const EXPORT_FIELDS: Array<{ column: string; field: string; type: 'text' | 'number' | 'url' }> = [
  { column: 'Name', field: 'name', type: 'text' },
  { column: 'Domain', field: 'domain', type: 'url' },
  { column: 'LinkedIn', field: 'linkedinUrl', type: 'url' },
  { column: 'Industry', field: 'industry', type: 'text' },
  { column: 'Size', field: 'size', type: 'text' },
  { column: 'Employees', field: 'employees', type: 'number' },
  { column: 'Revenue $M', field: 'revenueUsdM', type: 'number' },
  { column: 'City', field: 'city', type: 'text' },
  { column: 'State', field: 'state', type: 'text' },
  { column: 'Country', field: 'country', type: 'text' },
  { column: 'Founded', field: 'founded', type: 'number' },
  { column: 'Ticker', field: 'ticker', type: 'text' },
];

const exportBody = z.object({
  name: z.string().min(1).optional(),
  tableId: z.string().optional(),
  ids: z.array(z.string()).max(5000).optional(),
  filters: exploreQuery.partial().optional(),
  limit: z.coerce.number().min(1).max(5000).default(500),
});

@Controller('accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async explore(@Req() _request: Request, @Query() query: Record<string, string>) {
    const input = exploreQuery.parse(query);
    const where = buildAccountWhere(input);
    const [items, total] = await Promise.all([
      this.prisma.account.findMany({
        where,
        orderBy: buildOrderBy(input),
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.prisma.account.count({ where }),
    ]);
    return {
      items,
      total,
      page: input.page,
      pages: Math.max(1, Math.ceil(total / input.limit)),
      limit: input.limit,
    };
  }

  @Get('facets')
  async facets() {
    const [total, industries, states, sizes] = await Promise.all([
      this.prisma.account.count(),
      this.prisma.account.groupBy({
        by: ['industry'],
        _count: { _all: true },
        orderBy: { _count: { industry: 'desc' } },
        take: 60,
      }),
      this.prisma.account.groupBy({
        by: ['state'],
        _count: { _all: true },
        orderBy: { _count: { state: 'desc' } },
        take: 60,
      }),
      this.prisma.account.groupBy({
        by: ['size'],
        _count: { _all: true },
        orderBy: { _count: { size: 'desc' } },
      }),
    ]);
    return {
      total,
      industries: industries.map((f) => ({ value: f.industry, count: f._count._all })),
      states: states.map((f) => ({ value: f.state, count: f._count._all })),
      sizes: sizes.map((f) => ({ value: f.size, count: f._count._all })),
    };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  @Post('export')
  async exportToTable(@Req() request: Request, @Body() body: unknown) {
    const input = exportBody.parse(body);
    if (!input.ids?.length && !input.filters) {
      throw new BadRequestException('Provide ids or filters');
    }
    const where = input.ids?.length
      ? ({ id: { in: input.ids } } satisfies Prisma.AccountWhereInput)
      : buildAccountWhere(input.filters ?? {});
    const accounts = await this.prisma.account.findMany({
      where,
      orderBy: { revenueUsdM: { sort: 'desc', nulls: 'last' } },
      take: input.ids?.length ? input.ids.length : input.limit,
    });
    if (!accounts.length) throw new BadRequestException('No accounts matched');

    const tableId = await this.prisma.$transaction(async (tx) => {
      let table = input.tableId
        ? await tx.table.findFirst({
            where: { id: input.tableId, workspaceId: request.user.workspaceId },
            include: { columns: true },
          })
        : null;
      if (input.tableId && !table) throw new NotFoundException('Table not found');
      if (table) await assertWorkbookAccess(this.prisma, request.user, table.workbookId);
      if (!table) {
        const workbook =
          (await tx.workbook.findFirst({
            where: { workspaceId: request.user.workspaceId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })) ??
          (await tx.workbook.create({
            data: { workspaceId: request.user.workspaceId, name: 'Default workbook', position: 0 },
          }));
        table = await tx.table.create({
          data: {
            workspaceId: request.user.workspaceId,
            workbookId: workbook.id,
            name: input.name ?? 'Account export',
            position: await tx.table.count({ where: { workbookId: workbook.id } }),
          },
          include: { columns: true },
        });
      }
      const columns = [...table.columns];
      for (const field of EXPORT_FIELDS) {
        if (columns.some((c) => c.name.toLowerCase() === field.column.toLowerCase())) continue;
        columns.push(
          await tx.column.create({
            data: {
              tableId: table.id,
              name: field.column,
              type: field.type,
              kind: 'input',
              config: {},
              position: columns.length,
            },
          }),
        );
      }
      const byName = new Map(columns.map((c) => [c.name.toLowerCase(), c]));
      const base = await tx.row.count({ where: { tableId: table.id } });
      for (const [i, account] of accounts.entries()) {
        const row = await tx.row.create({ data: { tableId: table.id, position: base + i } });
        await tx.cell.createMany({
          data: EXPORT_FIELDS.map((f) => ({
            rowId: row.id,
            columnId: byName.get(f.column.toLowerCase())!.id,
            value: (account[f.field as keyof typeof account] ?? null) as Prisma.InputJsonValue,
            status: 'done' as const,
          })),
        });
      }
      return table.id;
    });
    return { tableId, rows: accounts.length };
  }
}
