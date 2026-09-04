import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

export type AuthResponse = {
  token: string;
  user: { id: string; email: string; name: string };
  workspaceId: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(email: string, password: string, name: string): Promise<AuthResponse> {
    const passwordHash = await argon2.hash(password);
    const user = await this.prisma.user.create({ data: { email, passwordHash, name } });
    const workspace = await this.prisma.workspace.create({
      data: {
        name: `${name}'s Workspace`,
        users: { create: { userId: user.id, role: 'owner' } },
      },
    });
    return this.issue(user, workspace.id);
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const membership = await this.prisma.membership.findFirst({ where: { userId: user.id } });
    if (!membership) throw new UnauthorizedException('No workspace membership');
    return this.issue(user, membership.workspaceId);
  }

  private issue(
    user: { id: string; email: string; name: string },
    workspaceId: string,
  ): AuthResponse {
    return {
      token: this.jwt.sign({ id: user.id, workspaceId }),
      user: { id: user.id, email: user.email, name: user.name },
      workspaceId,
    };
  }
}
