import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Prisma } from '@gtmai/db';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/roles';
import { PrismaService } from '../prisma/prisma.service';
type Request = FastifyRequest & { user: AuthUser };
const json = (value: unknown) => value as Prisma.InputJsonValue;
@Controller('usage')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsageController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @InjectQueue('usage') private readonly queue: Queue,
  ) {}
  @Get('budgets')
  async budgets(@Req() request: Request) {
    const budgets = await this.prisma.creditBudget.findMany({
      where: { workspaceId: request.user.workspaceId },
      orderBy: { scope: 'asc' },
    });
    return Promise.all(
      budgets.map(async (budget) => {
        if (budget.scope.startsWith('table:')) {
          const table = await this.prisma.table.findFirst({
            where: {
              id: budget.scope.slice('table:'.length),
              workspaceId: request.user.workspaceId,
            },
            select: { name: true },
          });
          return { ...budget, label: table?.name ?? budget.scope };
        }
        if (budget.scope.startsWith('workbook:')) {
          const workbook = await this.prisma.workbook.findFirst({
            where: {
              id: budget.scope.slice('workbook:'.length),
              workspaceId: request.user.workspaceId,
            },
            select: { name: true },
          });
          return { ...budget, label: workbook?.name ?? budget.scope };
        }
        return { ...budget, label: budget.scope };
      }),
    );
  }
  @Post('budgets')
  @Roles('admin')
  async createBudget(@Req() request: Request, @Body() body: unknown) {
    const input = z
      .object({
        scope: z.string().min(1),
        limit: z.number().positive(),
        period: z.enum(['daily', 'monthly']),
      })
      .parse(body);
    if (input.scope.startsWith('table:')) {
      const table = await this.prisma.table.findFirst({
        where: { id: input.scope.slice('table:'.length), workspaceId: request.user.workspaceId },
        select: { id: true },
      });
      if (!table) throw new Error('Table not found');
    } else if (input.scope.startsWith('workbook:')) {
      const workbook = await this.prisma.workbook.findFirst({
        where: { id: input.scope.slice('workbook:'.length), workspaceId: request.user.workspaceId },
        select: { id: true },
      });
      if (!workbook) throw new Error('Workbook not found');
    } else if (input.scope !== 'workspace' && !input.scope.startsWith('provider:')) {
      throw new Error('Invalid budget scope');
    }
    return this.prisma.creditBudget.upsert({
      where: {
        workspaceId_scope_period: {
          workspaceId: request.user.workspaceId,
          scope: input.scope,
          period: input.period,
        },
      },
      update: { limit: input.limit },
      create: { workspaceId: request.user.workspaceId, ...input },
    });
  }
  @Delete('budgets/:id')
  @Roles('admin')
  async deleteBudget(@Req() request: Request, @Param('id') id: string) {
    await this.prisma.creditBudget.deleteMany({
      where: { id, workspaceId: request.user.workspaceId },
    });
    return { ok: true };
  }
  @Get('summary')
  async summary(@Req() request: Request, @Query('groupBy') groupBy = 'day') {
    const ledger = await this.prisma.creditLedger.findMany({
      where: { workspaceId: request.user.workspaceId },
      include: { table: true },
      orderBy: { createdAt: 'asc' },
    });
    const values = new Map<string, number>();
    for (const item of ledger) {
      const key =
        groupBy === 'table'
          ? (item.table?.name ?? 'Workspace')
          : groupBy === 'provider'
            ? (item.reason.split(':')[0] ?? 'unknown')
            : item.createdAt.toISOString().slice(0, 10);
      values.set(key, (values.get(key) ?? 0) + Math.max(0, -item.delta));
    }
    return [...values.entries()].map(([key, spend]) => ({ key, spend }));
  }
  @Get('alerts')
  alerts(@Req() request: Request) {
    return this.prisma.alert.findMany({
      where: { workspaceId: request.user.workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @Post('rollup')
  async rollup(@Req() request: Request) {
    const job = await this.queue.add('rollup', { workspaceId: request.user.workspaceId });
    return { queued: true, jobId: job.id };
  }
  @Post('channels')
  channel(@Req() request: Request, @Body() body: unknown) {
    const input = z.object({ url: z.string().url() }).parse(body);
    return this.prisma.alertChannel.create({
      data: { workspaceId: request.user.workspaceId, type: 'webhook', url: input.url },
    });
  }
}
