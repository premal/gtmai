import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import Redis from 'ioredis';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('tables')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/events')
  async events(
    @Param('id') tableId: string,
    @Req() request: FastifyRequest & { user: AuthUser },
    @Res() response: FastifyReply,
  ): Promise<void> {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId: request.user.workspaceId },
      select: { id: true },
    });
    if (!table) {
      response.code(404).send({ error: 'Table not found' });
      return;
    }
    response.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const subscriber = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    await subscriber.subscribe(`table:${tableId}`);
    subscriber.on('message', (_channel, message) => response.raw.write(`data: ${message}\n\n`));
    request.raw.socket?.on('close', () => void subscriber.quit());
  }
}
