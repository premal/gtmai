import { Controller, Get, Inject, Param, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import Redis from 'ioredis';
import { JwtService } from '@nestjs/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('tables')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  @Get(':id/events')
  @ApiExcludeEndpoint()
  async events(
    @Param('id') tableId: string,
    @Req() request: FastifyRequest & { user: AuthUser },
    @Res() response: FastifyReply,
  ): Promise<void> {
    const query = request.query as { token?: string };
    if (query.token) {
      try {
        request.user = this.jwt.verify<AuthUser>(query.token);
      } catch {
        response.code(401).send({ error: 'Unauthorized' });
        return;
      }
    }
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId: request.user.workspaceId },
      select: { id: true },
    });
    if (!table) {
      response.code(404).send({ error: 'Table not found' });
      return;
    }
    response.hijack();
    response.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': request.headers.origin ?? '*',
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    });
    response.raw.write(': ok\n\n');
    const subscriber = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    await subscriber.subscribe(`table:${tableId}`);
    subscriber.on('message', (_channel, message) => response.raw.write(`data: ${message}\n\n`));
    request.raw.socket?.on('close', () => void subscriber.quit());
  }
}
