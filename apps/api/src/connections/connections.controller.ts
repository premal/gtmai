import { Body, Controller, Delete, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { providers } from '@gtmai/providers';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { decryptCredentials, encryptCredentials } from '../common/crypto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };

@Controller('connections')
@UseGuards(JwtAuthGuard)
export class ConnectionsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: Request) {
    const connections = await this.prisma.connection.findMany({
      where: { workspaceId: request.user.workspaceId },
      select: {
        id: true,
        name: true,
        provider: true,
        createdAt: true,
        updatedAt: true,
        createdBy: { select: { name: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const columns = await this.prisma.column.findMany({
      where: { table: { workspaceId: request.user.workspaceId } },
      select: { config: true },
    });
    return connections.map((connection) => ({
      ...connection,
      usedInColumns: columns.filter((column) =>
        JSON.stringify(column.config).includes(connection.provider),
      ).length,
    }));
  }

  @Get('catalog')
  catalog() {
    return providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      auth: provider.auth,
      actions: provider.actions.map((action) => ({
        id: action.id,
        name: action.name,
        category: action.category,
        creditCost: action.creditCost,
      })),
    }));
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

  @Post(':id/test')
  async test(@Param('id') id: string, @Req() request: Request) {
    const connection = await this.prisma.connection.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!connection) throw new Error('Connection not found');
    const provider = providers.find((item) => item.id === connection.provider);
    const action = provider?.actions[0];
    if (!provider || !action) throw new Error(`Unknown provider ${connection.provider}`);
    const credentials = decryptCredentials(connection.encryptedCredentials);
    const result = await action.run(
      provider.id === 'mock'
        ? { firstName: 'Connection', lastName: 'Test', domain: 'example.com' }
        : {},
      {
        credentials,
        fetch,
        logger: { info: () => undefined, error: () => undefined },
      },
    );
    return {
      ok: result.found,
      provider: connection.provider,
      message: result.found
        ? 'Connection test passed'
        : (result.reason ?? 'Connection test failed'),
    };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() request: Request) {
    await this.prisma.connection.deleteMany({
      where: { id, workspaceId: request.user.workspaceId },
    });
    return { ok: true };
  }
}
