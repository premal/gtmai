import { SetMetadata } from '@nestjs/common';
import type { MembershipRole } from '@gtmai/db';

export const ROLES_KEY = 'roles';

export function isAdmin(role: MembershipRole | string | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export const Roles = (...roles: MembershipRole[]) => SetMetadata(ROLES_KEY, roles);
