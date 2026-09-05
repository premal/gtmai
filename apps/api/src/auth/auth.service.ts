import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { MembershipRole } from '@gtmai/db';
import { PrismaService } from '../prisma/prisma.service';

export type AuthResponse = {
  token: string;
  user: { id: string; email: string; name: string; role: MembershipRole };
  workspaceId: string;
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const membership = await this.prisma.membership.findFirst({ where: { userId: user.id } });
    if (!membership) throw new UnauthorizedException('No workspace membership');
    return this.issue(user, membership.workspaceId, membership.role);
  }

  async acceptInvite(
    token: string,
    name: string | undefined,
    password: string,
  ): Promise<AuthResponse> {
    const invite = await this.prisma.invite.findUnique({ where: { token } });
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invite is expired or invalid');
    }
    let user = await this.prisma.user.findUnique({ where: { email: invite.email } });
    if (user) {
      if (!(await argon2.verify(user.passwordHash, password))) {
        throw new UnauthorizedException('Invalid credentials');
      }
    } else {
      user = await this.prisma.user.create({
        data: {
          email: invite.email,
          name: name?.trim() || invite.email.split('@')[0]!,
          passwordHash: await argon2.hash(password),
        },
      });
    }
    const membership = await this.prisma.membership.upsert({
      where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id } },
      update: { role: invite.role },
      create: { workspaceId: invite.workspaceId, userId: user.id, role: invite.role },
    });
    await this.prisma.invite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });
    return this.issue(user, invite.workspaceId, membership.role);
  }

  issue(
    user: { id: string; email: string; name: string },
    workspaceId: string,
    role: MembershipRole = 'owner',
  ): AuthResponse {
    return {
      token: this.jwt.sign({ id: user.id, workspaceId, role }),
      user: { id: user.id, email: user.email, name: user.name, role },
      workspaceId,
    };
  }
}
