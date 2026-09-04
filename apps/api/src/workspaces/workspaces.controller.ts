import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { WorkspaceScopedGuard } from '../common/workspace-scoped.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('workspaces')
@UseGuards(JwtAuthGuard, WorkspaceScopedGuard)
export class WorkspacesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get(':workspaceId/tables')
  listTables(@Param('workspaceId') workspaceId: string) {
    return this.prisma.table.findMany({
      where: { workspaceId },
      include: { columns: true, _count: { select: { rows: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  @Post(':workspaceId/tables')
  createTable(
    @Param('workspaceId') workspaceId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { user: AuthUser },
  ) {
    if (workspaceId !== request.user.workspaceId) throw new Error('Workspace access denied');
    const input = z.object({ name: z.string().min(1) }).parse(body);
    return this.prisma.table.create({ data: { workspaceId, name: input.name } });
  }
}
