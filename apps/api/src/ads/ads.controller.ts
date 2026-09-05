import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@gtmai/db';
import type { Queue } from 'bullmq';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };
const json = (value: unknown) => value as Prisma.InputJsonValue;
const platforms = z.array(z.enum(['mock', 'meta', 'google', 'linkedin'])).min(1);

@Controller('ads')
@UseGuards(JwtAuthGuard)
export class AdsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @InjectQueue('ads') private readonly queue: Queue,
  ) {}

  @Get('audiences')
  list(@Req() request: Request) {
    return this.prisma.adAudience.findMany({
      where: { workspaceId: request.user.workspaceId },
      include: { syncs: true },
      orderBy: { name: 'asc' },
    });
  }

  @Post('audiences')
  create(@Req() request: Request, @Body() body: unknown) {
    const input = z
      .object({ name: z.string().min(1), segmentId: z.string().optional(), platforms })
      .parse(body);
    return this.prisma.adAudience.create({
      data: {
        workspaceId: request.user.workspaceId,
        name: input.name,
        config: json({ segmentId: input.segmentId }),
        ...(input.segmentId ? { segmentId: input.segmentId } : {}),
        platforms: json(input.platforms),
      },
      include: { syncs: true },
    });
  }

  @Post('audiences/:id/sync')
  async sync(@Req() request: Request, @Param('id') id: string) {
    const audience = await this.prisma.adAudience.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!audience) throw new Error('Ad audience not found');
    const selected = Array.isArray(audience.platforms) ? audience.platforms.map(String) : [];
    for (const platform of selected) {
      await this.prisma.adPlatformSync.upsert({
        where: { audienceId_platform: { audienceId: id, platform } },
        update: { status: 'queued', error: null },
        create: { audienceId: id, platform, status: 'queued' },
      });
      await this.queue.add(
        'sync',
        { audienceId: id, platform, workspaceId: request.user.workspaceId },
        { jobId: `ads:${id}:${platform}` },
      );
    }
    return { queued: selected };
  }
}
