import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { encryptCredentials } from '../common/crypto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };

@Controller('connections')
@UseGuards(JwtAuthGuard)
export class ConnectionsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() request: Request) {
    return this.prisma.connection.findMany({
      where: { workspaceId: request.user.workspaceId },
      select: { id: true, name: true, provider: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  @Post()
  create(@Body() body: unknown, @Req() request: Request) {
    const input = z
      .object({
        provider: z.string().min(1),
        name: z.string().min(1),
        credentials: z.record(z.string()),
      })
      .parse(body);
    return this.prisma.connection.create({
      data: {
        workspaceId: request.user.workspaceId,
        createdById: request.user.id,
        provider: input.provider,
        name: input.name,
        encryptedCredentials: encryptCredentials(input.credentials),
      },
      select: { id: true, provider: true, name: true, createdAt: true },
    });
  }
}
