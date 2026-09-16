import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from './auth-user';

@Injectable()
export class WorkspaceScopedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest & { user: AuthUser }>();
    const params = request.params as Record<string, string>;
    const workspaceId = params.workspaceId ?? request.headers['x-workspace-id'];
    if (workspaceId && workspaceId !== request.user.workspaceId) {
      throw new ForbiddenException('Workspace access denied');
    }
    return true;
  }
}
