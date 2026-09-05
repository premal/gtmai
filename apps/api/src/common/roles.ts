import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { MembershipRole } from '@gtmai/db';
import type { AuthUser } from './auth-user';

export const ROLES_KEY = 'roles';

export function isAdmin(role: MembershipRole | string | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export const Roles = (...roles: MembershipRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector?: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.reflector) return true;
    const roles = this.reflector.getAllAndOverride<MembershipRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: AuthUser }>();
    const role = request.user?.role;
    if (!request.user) return true;
    if (roles.includes('admin') && isAdmin(role)) return true;
    if (role && roles.includes(role)) return true;
    throw new ForbiddenException(`Requires ${roles.join(' or ')}`);
  }
}
