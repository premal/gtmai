import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from './auth-user';
import { isAdmin, ROLES_KEY } from './roles';
import { PrismaService } from '../prisma/prisma.service';

type RequestWithUser = FastifyRequest & { user: AuthUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers.authorization;
    const query = request.query as { token?: string };
    const token = header?.startsWith('Bearer ') ? header.slice(7) : query.token;
    if (!token) {
      throw new UnauthorizedException();
    }
    if (token.startsWith('gtm_')) {
      const key = await this.prisma.apiKey.findFirst({
        where: { hash: createHash('sha256').update(token).digest('hex') },
        include: { workspace: { include: { users: { take: 1, include: { user: true } } } } },
      });
      const membership = key?.workspace.users[0];
      if (!key || !membership) throw new UnauthorizedException();
      await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
      request.user = {
        id: membership.user.id,
        workspaceId: key.workspaceId,
        role: 'editor',
      };
      this.assertViewerWrite(request);
      this.assertRoles(context, request.user);
      return true;
    }
    try {
      const payload = this.jwt.verify<AuthUser>(token);
      const membership = await this.prisma.membership.findUnique({
        where: { workspaceId_userId: { workspaceId: payload.workspaceId, userId: payload.id } },
      });
      if (!membership) throw new UnauthorizedException();
      request.user = { id: payload.id, workspaceId: payload.workspaceId, role: membership.role };
    } catch {
      throw new UnauthorizedException();
    }
    this.assertViewerWrite(request);
    this.assertRoles(context, request.user);
    return true;
  }

  private assertRoles(context: ExecutionContext, user: AuthUser): void {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return;
    if ((roles.includes('admin') && isAdmin(user.role)) || roles.includes(user.role)) return;
    throw new ForbiddenException(`Requires ${roles.join(' or ')}`);
  }

  private assertViewerWrite(request: RequestWithUser): void {
    if (
      request.user.role === 'viewer' &&
      request.method !== 'GET' &&
      !request.url.startsWith('/auth/')
    ) {
      throw new ForbiddenException('Viewers have read-only access');
    }
  }
}
