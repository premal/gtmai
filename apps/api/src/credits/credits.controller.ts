import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('credits')
@UseGuards(JwtAuthGuard)
export class CreditsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@Req() request: FastifyRequest & { user: AuthUser }) {
    const ledger = await this.prisma.creditLedger.findMany({
      where: { workspaceId: request.user.workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return { balance: ledger.reduce((total, item) => total + item.delta, 0), ledger };
  }
}
