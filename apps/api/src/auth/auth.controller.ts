import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';

const credentials = z.object({ email: z.string().email(), password: z.string().min(8) });

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post('login')
  login(@Body() body: unknown) {
    const input = credentials.parse(body);
    return this.auth.login(input.email, input.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() request: FastifyRequest & { user: AuthUser }) {
    const user = await this.prisma.user.findUnique({
      where: { id: request.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        memberships: {
          where: { workspaceId: request.user.workspaceId },
          select: { role: true, workspace: true },
        },
      },
    });
    return user ? { ...user, role: request.user.role } : null;
  }

  @Get('invites/:token')
  async invite(@Param('token') token: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { token },
      include: { workspace: true },
    });
    if (!invite) throw new Error('Invite not found');
    const existingUser = Boolean(
      await this.prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } }),
    );
    return {
      workspace: invite.workspace.name,
      email: invite.email,
      role: invite.role,
      expired: Boolean(invite.acceptedAt) || invite.expiresAt <= new Date(),
      existingUser,
    };
  }

  @Post('invites/:token/accept')
  acceptInvite(@Param('token') token: string, @Body() body: unknown) {
    const input = z
      .object({ name: z.string().min(1).optional(), password: z.string().min(8) })
      .parse(body);
    return this.auth.acceptInvite(token, input.name, input.password);
  }
}
