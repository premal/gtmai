import type { PrismaService } from '../prisma/prisma.service';

export async function getOrCreateDefaultWorkbook(prisma: PrismaService, workspaceId: string) {
  const existing = await prisma.workbook.findFirst({
    where: { workspaceId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (existing) return existing;
  return prisma.workbook.create({
    data: {
      workspaceId,
      name: 'Default workbook',
      position: 0,
    },
  });
}

export async function nextWorkbookPosition(prisma: PrismaService, workspaceId: string) {
  return prisma.workbook.count({ where: { workspaceId } });
}
