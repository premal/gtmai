import type { MembershipRole } from '@gtmai/db';

export type AuthUser = { id: string; workspaceId: string; role: MembershipRole };
