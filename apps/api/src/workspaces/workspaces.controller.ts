import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { WorkspaceScopedGuard } from '../common/workspace-scoped.guard';
import { PrismaService } from '../prisma/prisma.service';
import { getOrCreateDefaultWorkbook } from '../common/workbooks';

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
  async createTable(
    @Param('workspaceId') workspaceId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { user: AuthUser },
  ) {
    if (workspaceId !== request.user.workspaceId) throw new Error('Workspace access denied');
    const input = z.object({ name: z.string().min(1) }).parse(body);
    const workbook = await getOrCreateDefaultWorkbook(this.prisma, workspaceId);
    const position = await this.prisma.table.count({ where: { workbookId: workbook.id } });
    return this.prisma.table.create({
      data: { workspaceId, workbookId: workbook.id, name: input.name, position },
    });
  }

  @Patch(':workspaceId')
  renameWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { user: AuthUser },
  ) {
    if (workspaceId !== request.user.workspaceId) throw new Error('Workspace access denied');
    const input = z.object({ name: z.string().min(1) }).parse(body);
    return this.prisma.workspace.update({ where: { id: workspaceId }, data: { name: input.name } });
  }

  @Get(':workspaceId/members')
  members(@Param('workspaceId') workspaceId: string) {
    return this.prisma.membership.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }
}
