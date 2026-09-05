import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@gtmai/db';
import type { Queue } from 'bullmq';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
type Request = FastifyRequest & { user: AuthUser };
const json = (value: unknown) => value as Prisma.InputJsonValue;
const bodySchema = z.object({
  name: z.string().min(1),
  source: z.object({ kind: z.enum(['segment', 'table']), id: z.string() }),
  destination: z.object({
    provider: z.enum(['hubspot', 'salesforce', 'webhook', 'mock']),
    object: z.enum(['contact', 'company']),
    fieldMapping: z.record(z.string()),
    upsertKey: z.string().min(1),
  }),
  schedule: z.string().optional(),
});
@Controller('crm')
@UseGuards(JwtAuthGuard)
export class CrmController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @InjectQueue('crm') private readonly queue: Queue,
  ) {}
  @Get('jobs')
  list(@Req() request: Request) {
    return this.prisma.crmSyncJob.findMany({
      where: { workspaceId: request.user.workspaceId },
      include: { _count: { select: { records: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }
  @Post('jobs')
  async create(@Req() request: Request, @Body() body: unknown) {
    const input = bodySchema.parse(body);
    const created = await this.prisma.crmSyncJob.create({
      data: {
        workspaceId: request.user.workspaceId,
        name: input.name,
        source: json(input.source),
        destination: json(input.destination),
        ...(input.schedule ? { schedule: input.schedule } : {}),
      },
    });
    if (input.schedule)
      await this.queue.add(
        'run',
        { jobId: created.id, workspaceId: request.user.workspaceId },
        { repeat: { pattern: input.schedule } },
      );
    return created;
  }
  @Post('jobs/:id/run')
  async run(@Req() request: Request, @Param('id') id: string) {
    const job = await this.prisma.crmSyncJob.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!job) throw new Error('CRM sync job not found');
    const queued = await this.queue.add(
      'run',
      { jobId: id, workspaceId: request.user.workspaceId },
      { jobId: `crm:${id}:${Date.now()}` },
    );
    return { queued: true, jobId: queued.id };
  }
  @Patch('jobs/:id')
  async update(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = bodySchema.partial().parse(body);
    const job = await this.prisma.crmSyncJob.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!job) throw new Error('CRM sync job not found');
    return this.prisma.crmSyncJob.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.source ? { source: json(input.source) } : {}),
        ...(input.destination ? { destination: json(input.destination) } : {}),
        ...(input.schedule !== undefined ? { schedule: input.schedule || null } : {}),
      },
    });
  }
  @Get('jobs/:id/runs')
  runs(@Req() request: Request, @Param('id') id: string) {
    return this.prisma.crmSyncRun.findMany({
      where: { jobId: id, job: { workspaceId: request.user.workspaceId } },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
  }
}
