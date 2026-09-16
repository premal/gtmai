import * as argon2 from 'argon2';
import type { PrismaService } from './prisma/prisma.service';
import type { AuthService } from './auth/auth.service';

export async function createWorkspaceWithAdmin(
  prisma: PrismaService,
  auth: AuthService,
  email: string,
  name: string,
) {
  const user = await prisma.user.create({
    data: { email, name, passwordHash: await argon2.hash('password123') },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: `${name}'s Workspace`,
      users: { create: { userId: user.id, role: 'owner' } },
      workbooks: { create: { name: 'Default workbook', position: 0 } },
    },
  });
  return { token: auth.issue(user, workspace.id, 'owner').token, workspaceId: workspace.id };
}
