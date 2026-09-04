import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('credits')
@UseGuards(JwtAuthGuard)
export class CreditsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async get(@Req() request: FastifyRequest & { user: AuthUser }) {
    const ledger = await this.prisma.creditLedger.findMany({
      where: { workspaceId: request.user.workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return { balance: ledger.reduce((total, item) => total + item.delta, 0), ledger };
  }

  @Get('summary')
  async summary(@Req() request: FastifyRequest & { user: AuthUser }) {
    const ledger = await this.prisma.creditLedger.findMany({
      where: { workspaceId: request.user.workspaceId },
      include: { table: true },
      orderBy: { createdAt: 'asc' },
    });
    const byTable = new Map<string, { name: string; spend: number }>();
    const byProvider = new Map<string, number>();
    for (const entry of ledger) {
      const spend = Math.max(0, -entry.delta);
      const tableKey = entry.tableId ?? 'workspace';
      const current = byTable.get(tableKey) ?? { name: entry.table?.name ?? 'Workspace', spend: 0 };
      current.spend += spend;
      byTable.set(tableKey, current);
      const provider = entry.reason.split(':')[0] ?? 'unknown';
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
