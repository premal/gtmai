import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@gtmai/db';
import type { AuthUser } from './auth-user';
import { isAdmin } from './roles';
import type { PrismaService } from '../prisma/prisma.service';

export function accessibleWorkbookWhere(user: AuthUser): Prisma.WorkbookWhereInput {
  if (isAdmin(user.role)) return {};
  return {
    OR: [{ access: 'workspace' }, { collaborators: { some: { userId: user.id } } }],
  };
}

export async function assertWorkbookAccess(
  prisma: PrismaService,
  user: AuthUser,
  workbookId: string,
): Promise<void> {
  const workbook = await prisma.workbook.findFirst({
    where: { id: workbookId, workspaceId: user.workspaceId, ...accessibleWorkbookWhere(user) },
    select: { id: true },
  });
  if (!workbook) throw new ForbiddenException('No access to this workbook');
}
