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
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles } from '../common/roles';
import { accessibleWorkbookWhere, assertWorkbookAccess } from '../common/workbook-access';
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };
const workbookBody = z.object({
  name: z.string().min(1).optional(),
  folderId: z.string().nullable().optional(),
  position: z.number().int().min(0).optional(),
});

const workbookInclude = () => ({
  folder: true,
  tagAssignments: { include: { tag: true } },
  tables: {
    orderBy: [{ position: 'asc' as const }, { updatedAt: 'desc' as const }],
    select: {
      id: true,
      name: true,
      position: true,
      updatedAt: true,
      workbookId: true,
      _count: { select: { rows: true, columns: true } },
      tagAssignments: { include: { tag: true } },
    },
  },
  _count: { select: { tables: true } },
});

function flattenTags<T extends { tagAssignments: Array<{ tag: unknown }> }>(value: T) {
  const { tagAssignments, ...rest } = value;
  return { ...rest, tags: tagAssignments.map(({ tag }) => tag) };
}

function flattenWorkbook<
  T extends {
    tagAssignments: Array<{ tag: unknown }>;
    tables: Array<{ tagAssignments: Array<{ tag: unknown }> }>;
  },
>(value: T) {
  const workbook = flattenTags(value);
  return {
    ...workbook,
    tables: workbook.tables.map((table) => flattenTags(table)),
  };
}

@Controller('workbooks')
@UseGuards(JwtAuthGuard)
export class WorkbooksController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: Request) {
    const workbooks = await this.prisma.workbook.findMany({
      where: { workspaceId: request.user.workspaceId, ...accessibleWorkbookWhere(request.user) },
      include: workbookInclude(),
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return workbooks.map(flattenWorkbook);
  }

  @Get(':id')
  async get(@Req() request: Request, @Param('id') id: string) {
    const exists = await this.prisma.workbook.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
      select: { id: true },
    });
    if (!exists) throw new Error('Workbook not found');
    await assertWorkbookAccess(this.prisma, request.user, id);
    const workbook = await this.prisma.workbook.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
      include: {
        ...workbookInclude(),
        collaborators: { include: { user: { select: { id: true, email: true, name: true } } } },
      },
    });
    if (!workbook) throw new Error('Workbook not found');
    const { collaborators, ...value } = workbook;
    return {
      ...flattenWorkbook(value as never),
      access: workbook.access,
      collaborators: collaborators.map(({ user }) => ({
        userId: user.id,
        email: user.email,
        name: user.name,
      })),
    };
  }

  @Post()
  async create(@Req() request: Request, @Body() body: unknown) {
    const input = workbookBody.required({ name: true }).parse(body);
    if (input.folderId) await this.assertFolder(request.user.workspaceId, input.folderId);
    const position =
      input.position ??
      (await this.prisma.workbook.count({ where: { workspaceId: request.user.workspaceId } }));
    const data: Prisma.WorkbookUncheckedCreateInput = {
      workspaceId: request.user.workspaceId,
      name: input.name,
      folderId: input.folderId ?? null,
      position,
    };
    return this.prisma.workbook.create({ data });
  }

  @Patch(':id')
  async update(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = workbookBody.parse(body);
    await assertWorkbookAccess(this.prisma, request.user, id);
    const workbook = await this.prisma.workbook.findFirst({
      where: {
        id,
        workspaceId: request.user.workspaceId,
      },
    });
    if (!workbook) throw new Error('Workbook not found');
    if (input.folderId) await this.assertFolder(request.user.workspaceId, input.folderId);
    const data: Prisma.WorkbookUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.folderId !== undefined) {
      data.folder = input.folderId ? { connect: { id: input.folderId } } : { disconnect: true };
    }
    if (input.position !== undefined) data.position = input.position;
    return this.prisma.workbook.update({ where: { id }, data });
  }

  @Delete(':id')
  @Roles('admin')
  async remove(@Req() request: Request, @Param('id') id: string) {
    const count = await this.prisma.workbook.count({
      where: { workspaceId: request.user.workspaceId },
    });
    if (count <= 1) throw new Error('Cannot delete the last workbook in a workspace');
    const result = await this.prisma.workbook.deleteMany({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!result.count) throw new Error('Workbook not found');
    return { ok: true };
  }

  @Patch(':id/access')
  @Roles('admin')
  async access(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = z
      .object({
        access: z.enum(['workspace', 'restricted']),
        collaboratorUserIds: z.array(z.string()),
      })
      .parse(body);
    const workbook = await this.prisma.workbook.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
      select: { id: true },
    });
    if (!workbook) throw new Error('Workbook not found');
    const users = await this.prisma.membership.findMany({
      where: { workspaceId: request.user.workspaceId, userId: { in: input.collaboratorUserIds } },
      select: { userId: true },
    });
    if (users.length !== input.collaboratorUserIds.length)
      throw new Error('Collaborator not found');
    await this.prisma.$transaction([
      this.prisma.workbook.update({ where: { id }, data: { access: input.access } }),
      this.prisma.workbookCollaborator.deleteMany({ where: { workbookId: id } }),
      this.prisma.workbookCollaborator.createMany({
        data: input.collaboratorUserIds.map((userId) => ({ workbookId: id, userId })),
      }),
    ]);
    return this.get(request, id);
  }

  private async assertFolder(workspaceId: string, folderId: string) {
    const folder = await this.prisma.folder.findFirst({ where: { id: folderId, workspaceId } });
    if (!folder) throw new Error('Folder not found');
  }
}
