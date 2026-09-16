import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };
type Tag = { id: string; name: string; color: string | null };

const tagInclude = { tagAssignments: { include: { tag: true } } } as const;

function tagsOf(value: { tagAssignments: Array<{ tag: Tag }> }): Tag[] {
  return value.tagAssignments.map(({ tag }) => tag);
}

function matches(
  query: string,
  tagIds: string[],
): {
  OR?: Array<Record<string, unknown>>;
  AND?: Array<Record<string, unknown>>;
} {
  const where: {
    OR?: Array<Record<string, unknown>>;
    AND?: Array<Record<string, unknown>>;
  } = {};
  if (query) {
    where.OR = [
      { name: { contains: query, mode: 'insensitive' } },
      { tagAssignments: { some: { tag: { name: { contains: query, mode: 'insensitive' } } } } },
    ];
  }
  if (tagIds.length) {
    where.AND = tagIds.map((tagId) => ({
      tagAssignments: { some: { tagId } },
    }));
  }
  return where;
}

@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async search(@Req() request: Request, @Query() query: Record<string, unknown>) {
    const input = z
      .object({
        q: z.string().trim().default(''),
        tagIds: z.string().default(''),
      })
      .parse(query);
    const tagIds = input.tagIds
      .split(',')
      .map((tagId) => tagId.trim())
      .filter(Boolean);
    if (!input.q && !tagIds.length) throw new Error('Search query or tagIds is required');

    const scope = { workspaceId: request.user.workspaceId };
    const where = matches(input.q, tagIds);
    const [folders, workbooks, tables] = await Promise.all([
      this.prisma.folder.findMany({
        where: { ...scope, ...where },
        include: { ...tagInclude, parent: true },
        orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.workbook.findMany({
        where: { ...scope, ...where },
        include: { ...tagInclude, folder: true },
        orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.table.findMany({
        where: { ...scope, ...where },
        include: { ...tagInclude, workbook: { include: { folder: true } } },
        orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      }),
    ]);

    return {
      folders: folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        kind: 'folder' as const,
        tags: tagsOf(folder),
        folderId: folder.parentId ?? undefined,
        folderName: folder.parent?.name,
        updatedAt: folder.updatedAt,
      })),
      workbooks: workbooks.map((workbook) => ({
        id: workbook.id,
        name: workbook.name,
        kind: 'workbook' as const,
        tags: tagsOf(workbook),
        folderId: workbook.folderId ?? undefined,
        folderName: workbook.folder?.name,
        updatedAt: workbook.updatedAt,
      })),
      tables: tables.map((table) => ({
        id: table.id,
        name: table.name,
        kind: 'table' as const,
        tags: tagsOf(table),
        workbookId: table.workbookId,
        workbookName: table.workbook.name,
        folderId: table.workbook.folderId ?? undefined,
        folderName: table.workbook.folder?.name,
        updatedAt: table.updatedAt,
      })),
    };
  }
}
