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
import { Prisma } from '@gtmai/db';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };
const stepSchema = z.object({
  position: z.number().int().nonnegative(),
  delayHours: z.number().int().nonnegative().default(0),
  subjectTemplate: z.string(),
  bodyTemplate: z.string(),
});
const sequenceSchema = z.object({
  name: z.string().min(1),
  inboxId: z.string().optional(),
  steps: z.array(stepSchema).min(1),
});
const json = (value: unknown) => value as Prisma.InputJsonValue;

@Controller('inboxes')
@UseGuards(JwtAuthGuard)
export class InboxesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() request: Request) {
    return this.prisma.inbox.findMany({
      where: { workspaceId: request.user.workspaceId },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  create(@Req() request: Request, @Body() body: unknown) {
    const input = z
      .object({ name: z.string().min(1), config: z.record(z.unknown()).default({}) })
      .parse(body);
    return this.prisma.inbox.create({
      data: { workspaceId: request.user.workspaceId, name: input.name, config: json(input.config) },
    });
  }
}

@Controller('sequences')
@UseGuards(JwtAuthGuard)
export class SequencesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() request: Request) {
    return this.prisma.sequence.findMany({
      where: { workspaceId: request.user.workspaceId },
      include: {
        steps: { orderBy: { position: 'asc' } },
        inbox: true,
        _count: { select: { campaigns: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Get(':id')
  get(@Req() request: Request, @Param('id') id: string) {
    return this.prisma.sequence.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
      include: { steps: { orderBy: { position: 'asc' } }, inbox: true },
    });
  }

  @Post()
  async create(@Req() request: Request, @Body() body: unknown) {
    const input = sequenceSchema.parse(body);
    const sequence = await this.prisma.sequence.create({
      data: {
        workspaceId: request.user.workspaceId,
        name: input.name,
        ...(input.inboxId ? { inboxId: input.inboxId } : {}),
        steps: { create: input.steps.map((step) => ({ ...step })) },
      },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    return sequence;
  }

  @Patch(':id')
  async update(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = sequenceSchema.partial().parse(body);
    const existing = await this.prisma.sequence.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!existing) throw new Error('Sequence not found');
    return this.prisma.$transaction(async (tx) => {
      if (input.steps) await tx.sequenceStep.deleteMany({ where: { sequenceId: id } });
      return tx.sequence.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.inboxId !== undefined ? { inboxId: input.inboxId } : {}),
          ...(input.steps ? { steps: { create: input.steps.map((step) => ({ ...step })) } } : {}),
        },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
    });
  }

  @Delete(':id')
  async remove(@Req() request: Request, @Param('id') id: string) {
    await this.prisma.sequence.deleteMany({ where: { id, workspaceId: request.user.workspaceId } });
    return { ok: true };
  }
}
