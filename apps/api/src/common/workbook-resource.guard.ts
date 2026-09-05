import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from './auth-user';
import { accessibleWorkbookWhere } from './workbook-access';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WorkbookResourceGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user: AuthUser; params: Record<string, string> }>();
    const tableId = request.params.tableId ?? request.params.id;
    if (!tableId) return true;
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId: request.user.workspaceId },
      select: { workbookId: true },
    });
    if (!table) return true;
    const workbook = await this.prisma.workbook.findFirst({
      where: {
        id: table.workbookId,
        workspaceId: request.user.workspaceId,
        ...accessibleWorkbookWhere(request.user),
      },
      select: { id: true },
    });
    if (!workbook) throw new ForbiddenException('No access to this workbook');
    return true;
  }
}
