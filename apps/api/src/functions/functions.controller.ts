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
import { evaluateFormula, getPath, resolveBindings } from '@gtmai/shared';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };
const programSchema = z.object({
  inputs: z.array(z.object({ name: z.string(), type: z.string() })).default([]),
  nodes: z.array(z.record(z.unknown())).default([]),
  output: z.string().min(1),
});
const functionBody = z.object({ name: z.string().min(1) });
const versionBody = z.object({
  program: programSchema,
  testCases: z.array(z.object({ input: z.record(z.unknown()), expected: z.unknown() })).default([]),
});
const json = (value: unknown) => value as Prisma.InputJsonValue;

@Controller('functions')
@UseGuards(JwtAuthGuard)
export class FunctionsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() request: Request) {
    return this.prisma.function.findMany({
      where: { workspaceId: request.user.workspaceId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  create(@Req() request: Request, @Body() body: unknown) {
    const input = functionBody.parse(body);
    return this.prisma.function.create({
      data: { workspaceId: request.user.workspaceId, name: input.name },
    });
  }

  @Patch(':id')
  update(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = functionBody.parse(body);
    return this.prisma.function.update({
      where: { id, workspaceId: request.user.workspaceId },
      data: input,
    });
  }

  @Delete(':id')
  async remove(@Req() request: Request, @Param('id') id: string) {
    await this.prisma.function.deleteMany({ where: { id, workspaceId: request.user.workspaceId } });
    return { ok: true };
  }

  @Post(':id/versions')
  async publish(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = versionBody.parse(body);
    const fn = await this.prisma.function.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!fn) throw new Error('Function not found');
    const latest = await this.prisma.functionVersion.findFirst({
      where: { functionId: id },
      orderBy: { version: 'desc' },
    });
    return this.prisma.functionVersion.create({
      data: {
        functionId: id,
        version: (latest?.version ?? 0) + 1,
        program: json(input.program),
        testCases: json(input.testCases),
      },
    });
  }

  @Post(':id/test')
  async test(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = z
      .object({
        version: z.number().optional(),
        testCases: z
          .array(z.object({ input: z.record(z.unknown()), expected: z.unknown() }))
          .optional(),
      })
      .parse(body ?? {});
    const fn = await this.prisma.function.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    const version = fn?.versions.find(
      (item) => input.version === undefined || item.version === input.version,
    );
    if (!version) throw new Error('Function version not found');
    const cases =
      input.testCases ??
      ((version.testCases as Array<{ input: Record<string, unknown>; expected: unknown }>) || []);
    const results = cases.map((testCase) => {
      const output = runProgram(version.program as { output: string }, testCase.input);
      return {
        input: testCase.input,
        expected: testCase.expected,
        output,
        pass: JSON.stringify(output) === JSON.stringify(testCase.expected),
      };
    });
    return { version: version.version, passed: results.every((item) => item.pass), results };
  }
}

export function runProgram(program: { output: string }, input: Record<string, unknown>): unknown {
  const expression = program.output.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, path: string) => {
    const value = getPath(input, path.trim());
    return value === undefined ? '' : String(value);
  });
  if (expression.includes('(') || expression.includes('"')) {
    try {
      return evaluateFormula(program.output, input);
    } catch {
      return resolveBindings(program.output, input);
    }
  }
  return expression;
}
