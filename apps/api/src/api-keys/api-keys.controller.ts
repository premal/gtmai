import { createHash, randomBytes } from 'node:crypto';
import { Body, Controller, Delete, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles } from '../common/roles';
import { PrismaService } from '../prisma/prisma.service';
type Request = FastifyRequest & { user: AuthUser };
@Controller('api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get()
  list(@Req() request: Request) {
    return this.prisma.apiKey.findMany({
      where: { workspaceId: request.user.workspaceId },
      select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  @Post()
  @Roles('admin')
  async create(@Req() request: Request, @Body() body: unknown) {
    const input = z.object({ name: z.string().min(1) }).parse(body);
    const plaintext = `gtm_${randomBytes(24).toString('base64url')}`;
    const created = await this.prisma.apiKey.create({
      data: {
        workspaceId: request.user.workspaceId,
        name: input.name,
        prefix: plaintext.slice(0, 12),
        hash: createHash('sha256').update(plaintext).digest('hex'),
      },
      select: { id: true, name: true, prefix: true, createdAt: true },
    });
    return { ...created, key: plaintext };
  }
  @Delete(':id')
  @Roles('admin')
  async remove(@Req() request: Request, @Param('id') id: string) {
    await this.prisma.apiKey.deleteMany({ where: { id, workspaceId: request.user.workspaceId } });
    return { ok: true };
  }
}
