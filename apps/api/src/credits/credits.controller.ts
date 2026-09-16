import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('credits')
@UseGuards(JwtAuthGuard)
export class CreditsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async get(
    @Req() request: FastifyRequest & { user: AuthUser },
    @Query() query: { page?: string; pageSize?: string },
  ) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 25)));
    const where = { workspaceId: request.user.workspaceId };
    const [ledger, total, balance] = await Promise.all([
      this.prisma.creditLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { table: { select: { name: true } } },
      }),
      this.prisma.creditLedger.count({ where }),
      this.prisma.creditLedger.aggregate({ where, _sum: { delta: true } }),
    ]);
    return {
      balance: balance._sum.delta ?? 0,
      ledger,
      page,
      pageSize,
      total,
      pages: Math.ceil(total / pageSize),
    };
  }

  @Get('summary')
  async summary(@Req() request: FastifyRequest & { user: AuthUser }) {
    const ledger = await this.prisma.creditLedger.findMany({
      where: { workspaceId: request.user.workspaceId },
      include: { table: true },
      orderBy: { createdAt: 'asc' },
    });
    const cellIds = ledger.flatMap((entry) =>
      entry.refType === 'cell' && entry.refId ? [entry.refId] : [],
    );
    const cells = await this.prisma.cell.findMany({
      where: { id: { in: cellIds } },
      select: { id: true, provider: true },
    });
    const providerByCell = new Map(cells.map((cell) => [cell.id, cell.provider]));
    const byTable = new Map<string, { name: string; spend: number }>();
    const byProvider = new Map<string, number>();
    for (const entry of ledger) {
      const spend = Math.max(0, -entry.delta);
      const tableKey = entry.tableId ?? 'workspace';
      const current = byTable.get(tableKey) ?? { name: entry.table?.name ?? 'Workspace', spend: 0 };
      current.spend += spend;
      byTable.set(tableKey, current);
      let provider = 'unknown';
      if (entry.refType === 'cell' && entry.refId) {
        provider = providerByCell.get(entry.refId) ?? provider;
      }
      byProvider.set(provider, (byProvider.get(provider) ?? 0) + spend);
    }
    return {
      balance: ledger.reduce((total, item) => total + item.delta, 0),
      byTable: [...byTable.entries()].map(([tableId, value]) => ({ tableId, ...value })),
      byProvider: [...byProvider.entries()].map(([provider, spend]) => ({ provider, spend })),
      daily: ledger.reduce<Record<string, number>>((result, entry) => {
        const day = entry.createdAt.toISOString().slice(0, 10);
        result[day] = (result[day] ?? 0) + Math.max(0, -entry.delta);
        return result;
      }, {}),
    };
  }
}
