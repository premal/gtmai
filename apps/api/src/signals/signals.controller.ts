import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { QueueEvents, type Queue } from 'bullmq';
import Redis from 'ioredis';
import { Prisma } from '@gtmai/db';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };
const definitionBody = z.object({
  name: z.string().min(1),
  type: z.enum(['job_change', 'new_hire', 'funding', 'website_visit', 'custom']),
  config: z.record(z.unknown()).default({}),
  triggerWorkflowId: z.string().optional(),
});

@Controller('signals')
export class SignalsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @InjectQueue('signals') private readonly queue: Queue,
  ) {}

  @Get('definitions')
  @UseGuards(JwtAuthGuard)
  listDefinitions(@Req() request: Request) {
    return this.prisma.signalDefinition.findMany({
      where: { workspaceId: request.user.workspaceId },
      select: {
        id: true,
        name: true,
        type: true,
        config: true,
        triggerWorkflowId: true,
        _count: { select: { events: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Post('definitions')
  @UseGuards(JwtAuthGuard)
  async createDefinition(@Req() request: Request, @Body() body: unknown) {
    const input = definitionBody.parse(body);
    const secret = randomBytes(24).toString('hex');
    const definition = await this.prisma.signalDefinition.create({
      data: {
        workspaceId: request.user.workspaceId,
        name: input.name,
        type: input.type,
        config: input.config as Prisma.InputJsonValue,
        ...(input.triggerWorkflowId ? { triggerWorkflowId: input.triggerWorkflowId } : {}),
        secret,
      },
    });
    const schedule = input.config.schedule;
    if (schedule === 'hourly' || schedule === 'daily') {
      await this.queue.add(
        `signal:${definition.id}`,
        { definitionId: definition.id, workspaceId: request.user.workspaceId },
        { repeat: { every: schedule === 'hourly' ? 3_600_000 : 86_400_000 } },
      );
    }
    return { ...definition, secret };
  }

  @Post('definitions/:id/poll')
  @UseGuards(JwtAuthGuard)
  async poll(@Req() request: Request, @Param('id') id: string) {
    const definition = await this.prisma.signalDefinition.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!definition) throw new Error('Signal definition not found');
    const job = await this.queue.add('poll', {
      definitionId: id,
      workspaceId: request.user.workspaceId,
    });
    const events = new QueueEvents('signals', {
      connection: new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
      }),
    });
    try {
      const result = await job.waitUntilFinished(events, 30_000);
      return { queued: false, completed: true, jobId: job.id, result };
    } finally {
      await events.close();
    }
  }

  @Get('events')
  @UseGuards(JwtAuthGuard)
  events(
    @Req() request: Request,
    @Query('definitionId') definitionId?: string,
    @Query('contactId') contactId?: string,
    @Query('companyId') companyId?: string,
    @Query('since') since?: string,
  ) {
    const where: Prisma.SignalEventWhereInput = {
      definition: { workspaceId: request.user.workspaceId },
    };
    if (definitionId) where.definitionId = definitionId;
    if (contactId) where.contactId = contactId;
    if (companyId) where.companyId = companyId;
    if (since) where.occurredAt = { gte: new Date(since) };
    return this.prisma.signalEvent.findMany({
      where,
      include: {
        definition: { select: { id: true, name: true, type: true } },
        contact: true,
        company: true,
      },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  }

  @Post('ingest/:definitionId')
  async ingest(
    @Param('definitionId') definitionId: string,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ) {
    const definition = await this.prisma.signalDefinition.findUnique({
      where: { id: definitionId },
    });
    if (!definition || !definition.secret) throw new Error('Signal definition not found');
    const signature = String(request.headers['x-signal-signature'] ?? '');
    const payload = JSON.stringify(body ?? {});
    const expected = createHmac('sha256', definition.secret).update(payload).digest('hex');
    if (
      !signature ||
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      throw new Error('Invalid signal signature');
    }
    const input = z
      .object({
        email: z.string().email().optional(),
        domain: z.string().optional(),
        dedupeKey: z.string().optional(),
        payload: z.record(z.unknown()).default({}),
        occurredAt: z.coerce.date().optional(),
      })
      .parse(body);
    const contact = input.email
      ? await this.prisma.contact.findFirst({
          where: { workspaceId: definition.workspaceId, emailKey: input.email.toLowerCase() },
        })
      : null;
    const company = input.domain
      ? await this.prisma.company.findFirst({
          where: { workspaceId: definition.workspaceId, domainKey: input.domain.toLowerCase() },
        })
      : null;
    const payloadRecord = input.payload as Record<string, unknown>;
    const dedupeKey =
      input.dedupeKey ??
      (typeof payloadRecord.hash === 'string' ? payloadRecord.hash : undefined) ??
      (typeof payloadRecord.key === 'string' ? payloadRecord.key : undefined) ??
      createHash('sha256').update(JSON.stringify(input.payload)).digest('hex');
    const existing = await this.prisma.signalEvent.findUnique({
      where: { definitionId_dedupeKey: { definitionId, dedupeKey } },
    });
    if (existing) return existing;
    return this.prisma.signalEvent.create({
      data: {
        definitionId,
        dedupeKey,
        ...(contact ? { contactId: contact.id } : {}),
        ...(company ? { companyId: company.id } : {}),
        payload: input.payload as Prisma.InputJsonValue,
        occurredAt: input.occurredAt ?? new Date(),
      },
    });
  }
}
