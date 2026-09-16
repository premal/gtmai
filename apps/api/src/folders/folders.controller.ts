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
import { accessibleWorkbookWhere } from '../common/workbook-access';
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };
const folderBody = z.object({
  name: z.string().min(1).optional(),
  parentId: z.string().nullable().optional(),
  position: z.number().int().min(0).optional(),
});

function withTags<
  T extends { tagAssignments: Array<{ tag: { id: string; name: string; color: string | null } }> },
>(folder: T) {
  const { tagAssignments, ...value } = folder;
  return { ...value, tags: tagAssignments.map(({ tag }) => tag) };
}

@Controller('folders')
@UseGuards(JwtAuthGuard)
export class FoldersController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: Request) {
    const folders = await this.prisma.folder.findMany({
      where: {
        workspaceId: request.user.workspaceId,
        ...(request.user.role === 'owner' || request.user.role === 'admin'
          ? {}
          : { workbooks: { some: accessibleWorkbookWhere(request.user) } }),
      },
      include: { tagAssignments: { include: { tag: true } } },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    return folders.map(withTags);
  }

  @Post()
  async create(@Req() request: Request, @Body() body: unknown) {
    const input = folderBody.required({ name: true }).parse(body);
    if (input.parentId) {
      const parent = await this.prisma.folder.findFirst({
        where: { id: input.parentId, workspaceId: request.user.workspaceId },
      });
      if (!parent) throw new Error('Parent folder not found');
    }
    const position =
      input.position ??
      (await this.prisma.folder.count({
        where: { workspaceId: request.user.workspaceId, parentId: input.parentId ?? null },
      }));
    const data: Prisma.FolderUncheckedCreateInput = {
      workspaceId: request.user.workspaceId,
      name: input.name,
      parentId: input.parentId ?? null,
      position,
    };
    return this.prisma.folder.create({
      data,
    });
  }

  @Patch(':id')
  async update(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = folderBody.parse(body);
    const folder = await this.prisma.folder.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!folder) throw new Error('Folder not found');
    if (input.parentId) {
      const parent = await this.prisma.folder.findFirst({
        where: { id: input.parentId, workspaceId: request.user.workspaceId },
      });
      if (!parent || parent.id === id) throw new Error('Parent folder not found');
    }
    const data: Prisma.FolderUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.parentId !== undefined) {
      data.parent = input.parentId ? { connect: { id: input.parentId } } : { disconnect: true };
    }
    if (input.position !== undefined) data.position = input.position;
    return this.prisma.folder.update({ where: { id }, data });
  }

  @Delete(':id')
  async remove(@Req() request: Request, @Param('id') id: string) {
    const result = await this.prisma.folder.deleteMany({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!result.count) throw new Error('Folder not found');
    return { ok: true };
  }
}
