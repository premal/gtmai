import { randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/roles';
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };
const roleSchema = z.enum(['admin', 'editor', 'viewer']);

@Controller('team')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class TeamController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('members')
  async members(@Req() request: Request) {
    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId: request.user.workspaceId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((membership) => ({
      id: membership.id,
      userId: membership.user.id,
      email: membership.user.email,
      name: membership.user.name,
      role: membership.role,
      createdAt: membership.createdAt,
    }));
  }

  @Patch('members/:id')
  async updateMember(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = z.object({ role: roleSchema }).parse(body);
    const membership = await this.prisma.membership.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!membership) throw new Error('Member not found');
    if (isAdminRole(membership.role) && !isAdminRole(input.role)) {
      await this.assertNotLastAdmin(request.user.workspaceId, membership.id);
    }
    return this.prisma.membership.update({ where: { id }, data: { role: input.role } });
  }

  @Delete('members/:id')
  async removeMember(@Req() request: Request, @Param('id') id: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!membership) throw new Error('Member not found');
    if (isAdminRole(membership.role)) {
      await this.assertNotLastAdmin(request.user.workspaceId, membership.id);
    }
    await this.prisma.membership.delete({ where: { id } });
    return { ok: true };
  }

  @Get('invites')
  invites(@Req() request: Request) {
    return this.prisma.invite.findMany({
      where: { workspaceId: request.user.workspaceId, acceptedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('invites')
  async createInvite(@Req() request: Request, @Body() body: unknown) {
    const input = z.object({ email: z.string().email(), role: roleSchema }).parse(body);
    const invite = await this.prisma.invite.create({
      data: {
        workspaceId: request.user.workspaceId,
        email: input.email,
        role: input.role,
        token: randomBytes(24).toString('base64url'),
        invitedById: request.user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return {
      ...invite,
      url: `${process.env.WEB_URL ?? 'http://localhost:3000'}/invite/${invite.token}`,
    };
  }

  @Delete('invites/:id')
  async removeInvite(@Req() request: Request, @Param('id') id: string) {
    await this.prisma.invite.deleteMany({ where: { id, workspaceId: request.user.workspaceId } });
    return { ok: true };
  }

  private async assertNotLastAdmin(workspaceId: string, membershipId: string) {
    const count = await this.prisma.membership.count({
      where: { workspaceId, role: { in: ['owner', 'admin'] }, id: { not: membershipId } },
    });
    if (count === 0) throw new Error('Workspace needs at least one admin');
  }
}

function isAdminRole(role: string): boolean {
  return role === 'owner' || role === 'admin';
}
