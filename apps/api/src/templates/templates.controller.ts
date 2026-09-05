import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Prisma } from '@gtmai/db';
import { builtInTemplates } from '@gtmai/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { createRowWithValues } from '../tables/row-helper';

type Request = FastifyRequest & { user: AuthUser };
type TemplateKind = 'table' | 'workflow' | 'function';
type BuiltIn = {
  id: string;
  name: string;
  kind: TemplateKind;
  definition: Record<string, unknown>;
};
const builtIns = builtInTemplates as unknown as BuiltIn[];
const json = (value: unknown) => value as Prisma.InputJsonValue;

@Controller('templates')
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: Request) {
    const saved = await this.prisma.template.findMany({
      where: { OR: [{ workspaceId: request.user.workspaceId }, { workspaceId: null }] },
      orderBy: { name: 'asc' },
    });
    return [...builtIns, ...saved];
  }

  @Post()
  create(@Req() request: Request, @Body() body: unknown) {
    const input = z
      .object({
        name: z.string().min(1),
        kind: z.enum(['table', 'workflow', 'function']),
        definition: z.record(z.unknown()),
      })
      .parse(body);
    return this.prisma.template.create({
      data: {
        workspaceId: request.user.workspaceId,
        name: input.name,
        kind: input.kind,
        definition: json(input.definition),
      },
    });
  }

  @Post(':id/instantiate')
  async instantiate(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = z.object({ name: z.string().optional() }).parse(body ?? {});
    const saved = id.startsWith('builtin-')
      ? builtIns.find((template) => template.id === id)
      : await this.prisma.template.findFirst({
          where: { id, OR: [{ workspaceId: request.user.workspaceId }, { workspaceId: null }] },
        });
    if (!saved) throw new Error('Template not found');
    const name = input.name ?? saved.name;
    if (saved.kind === 'table') {
      const definition = saved.definition as {
        columns?: Array<{
          name: string;
          kind?: string;
          type?: string;
          config?: Record<string, unknown>;
        }>;
        rows?: Array<Record<string, unknown>>;
      };
      const table = await this.prisma.table.create({
        data: { workspaceId: request.user.workspaceId, name },
      });
      const columns = [];
      for (const [position, column] of (definition.columns ?? []).entries()) {
        columns.push(
          await this.prisma.column.create({
            data: {
              tableId: table.id,
              name: column.name,
              kind: (column.kind ?? 'input') as 'input',
              type: (column.type ?? 'text') as 'text',
              config: json(column.config ?? {}),
              position,
            },
          }),
        );
      }
      for (const [position, values] of (definition.rows ?? []).entries()) {
        const cellValues = Object.fromEntries(
          columns.map((column) => [column.id, values[column.name]]),
        );
        await createRowWithValues(this.prisma, table.id, columns, cellValues, position);
      }
      return { kind: 'table', id: table.id };
    }
    if (saved.kind === 'workflow') {
      const workflow = await this.prisma.workflow.create({
        data: { workspaceId: request.user.workspaceId, name, graph: json(saved.definition) },
      });
      return { kind: 'workflow', id: workflow.id };
    }
    const fn = await this.prisma.function.create({
      data: { workspaceId: request.user.workspaceId, name },
    });
    await this.prisma.functionVersion.create({
      data: { functionId: fn.id, version: 1, program: json(saved.definition) },
    });
    return { kind: 'function', id: fn.id };
  }
}
