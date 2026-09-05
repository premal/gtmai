import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from './auth-user';
import { PrismaService } from '../prisma/prisma.service';

type RequestWithUser = FastifyRequest & { user: AuthUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
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
      };
      return true;
    }
    try {
      request.user = this.jwt.verify<AuthUser>(token);
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
