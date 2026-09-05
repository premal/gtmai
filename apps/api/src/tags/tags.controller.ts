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
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };
const tagBody = z.object({ name: z.string().min(1), color: z.string().optional() });
const targetBody = z.object({
  folderId: z.string().optional(),
  workbookId: z.string().optional(),
  tableId: z.string().optional(),
});

@Controller('tags')
@UseGuards(JwtAuthGuard)
export class TagsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() request: Request) {
    return this.prisma.tag.findMany({
      where: { workspaceId: request.user.workspaceId },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  create(@Req() request: Request, @Body() body: unknown) {
    const input = tagBody.parse(body);
    return this.prisma.tag.create({
      data: {
        workspaceId: request.user.workspaceId,
        name: input.name,
        color: input.color ?? null,
      },
    });
  }

  @Patch(':id')
  async update(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = tagBody.partial().parse(body);
    const tag = await this.prisma.tag.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!tag) throw new Error('Tag not found');
    const data: Prisma.TagUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.color !== undefined) data.color = input.color;
    return this.prisma.tag.update({ where: { id }, data });
  }

  @Delete(':id')
  async remove(@Req() request: Request, @Param('id') id: string) {
    const result = await this.prisma.tag.deleteMany({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!result.count) throw new Error('Tag not found');
    return { ok: true };
  }

  @Post(':id/assign')
  assign(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.setAssignment(request, id, body);
  }

  @Post(':id/unassign')
  async unassign(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const target = targetBody.parse(body);
    const tag = await this.assertTag(request.user.workspaceId, id);
    const where = this.assignmentWhere(id, target);
    await this.prisma.tagAssignment.deleteMany({ where: { ...where, tagId: tag.id } });
    return { ok: true };
  }

  private async setAssignment(request: Request, id: string, body: unknown) {
    const target = targetBody.parse(body);
    const targetCount = Object.values(target).filter(Boolean).length;
    if (targetCount !== 1) throw new Error('Provide exactly one assignment target');
    const tag = await this.assertTag(request.user.workspaceId, id);
    await this.assertTarget(request.user.workspaceId, target);
    const data: Prisma.TagAssignmentUncheckedCreateInput = {
      tagId: tag.id,
      folderId: target.folderId ?? null,
      workbookId: target.workbookId ?? null,
      tableId: target.tableId ?? null,
    };
    return this.prisma.tagAssignment.upsert({
      where: this.assignmentWhere(id, target) as Prisma.TagAssignmentWhereUniqueInput,
      update: {},
      create: data,
    });
  }

  private assignmentWhere(tagId: string, target: z.infer<typeof targetBody>) {
    if (target.folderId) return { tagId_folderId: { tagId, folderId: target.folderId } };
    if (target.workbookId) return { tagId_workbookId: { tagId, workbookId: target.workbookId } };
    return { tagId_tableId: { tagId, tableId: target.tableId! } };
  }

  private async assertTag(workspaceId: string, id: string) {
    const tag = await this.prisma.tag.findFirst({ where: { id, workspaceId } });
    if (!tag) throw new Error('Tag not found');
    return tag;
  }

  private async assertTarget(workspaceId: string, target: z.infer<typeof targetBody>) {
    if (target.folderId) {
      const found = await this.prisma.folder.findFirst({
        where: { id: target.folderId, workspaceId },
      });
      if (!found) throw new Error('Folder not found');
    }
    if (target.workbookId) {
      const found = await this.prisma.workbook.findFirst({
        where: { id: target.workbookId, workspaceId },
      });
      if (!found) throw new Error('Workbook not found');
    }
    if (target.tableId) {
      const found = await this.prisma.table.findFirst({
        where: { id: target.tableId, workspaceId },
      });
      if (!found) throw new Error('Table not found');
    }
  }
}
