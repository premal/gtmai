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
import { completeChat, type AgentMessage } from '@gtmai/providers';
import { generatedSequence } from '@gtmai/shared';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { decryptCredentials } from '../common/crypto';
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

  @Post('generate')
  async generate(@Req() request: Request, @Body() body: unknown) {
    const input = z
      .object({
        name: z.string().min(1),
        description: z.string().min(3),
        steps: z.number().int().min(1).max(10).default(3),
        inboxId: z.string().optional(),
      })
      .parse(body);
    const integration = await this.prisma.integration.findFirst({
      where: {
        workspaceId: request.user.workspaceId,
        provider: { in: ['openai', 'anthropic', 'llm'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!integration) {
      throw new Error('No LLM integration — add an OpenAI or Anthropic key in Integrations');
    }
    const messages: AgentMessage[] = [
      {
        role: 'system',
        content: `You write B2B cold-email sequences. Respond only as JSON: {"steps":[{"delayHours":int,"subjectTemplate":string,"bodyTemplate":string}]}.
- Templates support {{contact.firstName}}, {{contact.lastName}}, {{contact.email}}, {{company.name}}, {{company.domain}} placeholders.
- First step has delayHours 0; space later steps 48-96 hours apart.
- Short, specific, plain-text copy — no buzzwords, no HTML.`,
      },
      {
        role: 'user',
        content: JSON.stringify({ description: input.description, steps: input.steps }),
      },
    ];
    let generated: z.infer<typeof generatedSequence> | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2 && !generated; attempt += 1) {
      try {
        const raw = await completeChat(
          {
            credentials: decryptCredentials(integration.encryptedCredentials),
            fetch,
            logger: { info: () => undefined, error: () => undefined },
          },
          messages,
          integration.provider === 'anthropic' ? 'anthropic' : 'openai',
        );
        generated = generatedSequence.parse(JSON.parse(raw));
      } catch (error) {
        lastError = error;
        messages.push({
          role: 'user',
          content: `That response was invalid (${error instanceof Error ? error.message : 'parse error'}). Reply with corrected JSON only.`,
        });
      }
    }
    if (!generated) {
      throw lastError instanceof Error ? lastError : new Error('Generation failed');
    }
    return this.prisma.sequence.create({
      data: {
        workspaceId: request.user.workspaceId,
        name: input.name,
        ...(input.inboxId ? { inboxId: input.inboxId } : {}),
        steps: {
          create: generated.steps.map((step, index) => ({
            position: index,
            delayHours: step.delayHours,
            subjectTemplate: step.subjectTemplate,
            bodyTemplate: step.bodyTemplate,
          })),
        },
      },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
  }

  @Delete(':id')
  async remove(@Req() request: Request, @Param('id') id: string) {
    await this.prisma.sequence.deleteMany({ where: { id, workspaceId: request.user.workspaceId } });
    return { ok: true };
  }
}
