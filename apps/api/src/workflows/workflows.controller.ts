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
  Res,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@gtmai/db';
import type { Queue } from 'bullmq';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { workflowGraphSchema, validateWorkflowGraph } from '@gtmai/shared';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };
const workflowBody = z.object({ name: z.string().min(1), graph: workflowGraphSchema });
const json = (value: unknown) => value as Prisma.InputJsonValue;

@Controller('workflows')
@UseGuards(JwtAuthGuard)
export class WorkflowsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @InjectQueue('workflows') private readonly queue: Queue,
  ) {}

  @Get()
  list(@Req() request: Request) {
    return this.prisma.workflow.findMany({
      where: { workspaceId: request.user.workspaceId },
      include: { _count: { select: { runs: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  @Post()
  create(@Req() request: Request, @Body() body: unknown) {
    const input = workflowBody.parse(body);
    const errors = validateWorkflowGraph(input.graph);
    if (errors.length) throw new Error(errors.join('; '));
    return this.prisma.workflow.create({
      data: { workspaceId: request.user.workspaceId, name: input.name, graph: json(input.graph) },
    });
  }

  @Patch(':id')
  update(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = workflowBody.partial().parse(body);
    if (input.graph) {
      const errors = validateWorkflowGraph(input.graph);
      if (errors.length) throw new Error(errors.join('; '));
    }
    const data: Prisma.WorkflowUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.graph !== undefined) data.graph = json(input.graph);
    return this.prisma.workflow.update({
      where: { id, workspaceId: request.user.workspaceId },
      data,
    });
  }

  @Delete(':id')
  async remove(@Req() request: Request, @Param('id') id: string) {
    await this.prisma.workflow.deleteMany({ where: { id, workspaceId: request.user.workspaceId } });
    return { ok: true };
  }

  @Post(':id/validate')
  async validate(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!workflow) throw new Error('Workflow not found');
    const graph = body
      ? workflowGraphSchema.parse((body as { graph?: unknown }).graph ?? body)
      : workflowGraphSchema.parse(workflow.graph);
    return {
      valid: validateWorkflowGraph(graph).length === 0,
      errors: validateWorkflowGraph(graph),
    };
  }

  @Post(':id/run')
  async run(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!workflow) throw new Error('Workflow not found');
    const input = z
      .record(z.unknown())
      .default({})
      .parse(body ?? {});
    const run = await this.prisma.workflowRun.create({
      data: { workflowId: id, input: json(input) },
    });
    await this.queue.add('run', { runId: run.id, workspaceId: request.user.workspaceId });
    return run;
  }

  @Get(':id/runs')
  runs(@Req() request: Request, @Param('id') id: string) {
    return this.prisma.workflowRun.findMany({
      where: { workflowId: id, workflow: { workspaceId: request.user.workspaceId } },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
  }

  @Get('runs/:runId')
  runDetails(@Req() request: Request, @Param('runId') runId: string) {
    return this.prisma.workflowRun.findFirst({
      where: { id: runId, workflow: { workspaceId: request.user.workspaceId } },
      include: { steps: { orderBy: { nodeId: 'asc' } }, workflow: true },
    });
  }

  @Get('runs/:runId/events')
  async runEvents(
    @Req() request: Request,
    @Param('runId') runId: string,
    @Res() reply: FastifyReply,
  ) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: runId, workflow: { workspaceId: request.user.workspaceId } },
    });
    if (!run) {
      reply.code(404).send({ message: 'Run not found' });
      return;
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': 'http://localhost:3000',
    });
    reply.raw.write(': ok\n\n');
    const timer = setInterval(async () => {
      const current = await this.prisma.workflowRun.findUnique({ where: { id: runId } });
      reply.raw.write(`data: ${JSON.stringify(current)}\n\n`);
      if (current?.status === 'done' || current?.status === 'error') {
        clearInterval(timer);
        reply.raw.end();
      }
    }, 1000);
    reply.raw.on('close', () => clearInterval(timer));
  }
}

@Controller('workflows/hooks')
export class WorkflowHooksController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @InjectQueue('workflows') private readonly queue: Queue,
  ) {}

  @Post(':id/:secret')
  async hook(@Param('id') id: string, @Param('secret') secret: string, @Body() body: unknown) {
    const workflow = await this.prisma.workflow.findUnique({ where: { id } });
    const graph = workflow
      ? (workflow.graph as { nodes?: Array<{ type: string; config: Record<string, unknown> }> })
      : undefined;
    const expected = graph?.nodes?.find((node) => node.type === 'trigger.webhook')?.config.secret;
    if (!workflow || !expected || expected !== secret) throw new Error('Invalid workflow hook');
    const run = await this.prisma.workflowRun.create({
      data: { workflowId: id, input: body as object },
    });
    await this.queue.add('run', { runId: run.id, workspaceId: workflow.workspaceId });
    return { runId: run.id };
  }
}
