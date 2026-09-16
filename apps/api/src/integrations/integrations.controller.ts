import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { normalizeLlmProviderId, providers } from '@gtmai/providers';
import type { CheckResult, Provider, RunContext } from '@gtmai/providers';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { decryptCredentials, encryptCredentials } from '../common/crypto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles } from '../common/roles';
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };

const systemProviders = new Set([
  'smtp',
  'meta',
  'google',
  'linkedin',
  'hubspot',
  'salesforce',
  'webhook',
]);

const silentLogger = { info: () => undefined, error: () => undefined };

async function probeFirstAction(provider: Provider, context: RunContext): Promise<CheckResult> {
  const action = provider.actions[0];
  if (!action) return { ok: false, message: `No actions for provider ${provider.id}` };
  const input =
    provider.id === 'mock'
      ? { firstName: 'Integration', lastName: 'Test', domain: 'example.com' }
      : {};
  try {
    const result = await action.run(input, context);
    if (result.found) return { ok: true, message: 'Integration test passed' };
    const reason = result.reason ?? 'test failed';
    if (/HTTP (401|403)/.test(reason)) {
      return { ok: false, message: `Credentials rejected — ${reason}` };
    }
    return { ok: true, message: `Credentials accepted — ${reason}` };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: true, message: 'Credentials stored — live probe needs row inputs' };
    }
    return {
      ok: false,
      message: `Could not verify — ${error instanceof Error ? error.message : 'test failed'}`,
    };
  }
}

async function probe(
  provider: Provider,
  credentials: Record<string, string>,
): Promise<CheckResult> {
  const context: RunContext = { credentials, fetch, logger: silentLogger };
  try {
    return provider.check
      ? await provider.check(context)
      : await probeFirstAction(provider, context);
  } catch (error) {
    return {
      ok: false,
      message: `Could not verify — ${error instanceof Error ? error.message : 'test failed'}`,
    };
  }
}

function columnUsesProvider(kind: string, config: unknown, providerId: string): boolean {
  const record = (config ?? {}) as Record<string, unknown>;
  if (kind === 'waterfall') {
    const items = Array.isArray(record.providers) ? record.providers : [];
    return items.some((item) => ((item ?? {}) as Record<string, unknown>).provider === providerId);
  }
  if (kind === 'agent') {
    const wanted = normalizeLlmProviderId(record.provider);
    // Legacy 'llm' integrations can only hold OpenAI or Anthropic keys.
    if (providerId === 'llm') return wanted === 'openai' || wanted === 'anthropic';
    return wanted === providerId;
  }
  return record.provider === providerId;
}

@Controller(['integrations', 'connections'])
@UseGuards(JwtAuthGuard)
export class IntegrationsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: Request) {
    const integrations = await this.prisma.integration.findMany({
      where: { workspaceId: request.user.workspaceId },
      select: {
        id: true,
        name: true,
        provider: true,
        createdAt: true,
        updatedAt: true,
        lastTestAt: true,
        lastTestOk: true,
        lastTestMessage: true,
        createdBy: { select: { name: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const columns = await this.prisma.column.findMany({
      where: { table: { workspaceId: request.user.workspaceId } },
      select: { kind: true, config: true },
    });
    const oldestByProvider = new Map<string, string>();
    for (const integration of [...integrations].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )) {
      if (!oldestByProvider.has(integration.provider)) {
        oldestByProvider.set(integration.provider, integration.id);
      }
    }
    return integrations.map((integration) => ({
      ...integration,
      isDefault: oldestByProvider.get(integration.provider) === integration.id,
      usedInColumns: columns.filter((column) =>
        columnUsesProvider(column.kind, column.config, integration.provider),
      ).length,
    }));
  }

  @Get('catalog')
  catalog() {
    return providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      auth: provider.auth,
      models: provider.models,
      actions: provider.actions.map((action) => ({
        id: action.id,
        name: action.name,
        category: action.category,
        sourceKind: action.sourceKind,
        creditCost: action.creditCost,
      })),
    }));
  }

  @Post()
  @Roles('admin')
  async create(@Body() body: unknown, @Req() request: Request) {
    const input = z
      .object({
        provider: z.string().min(1),
        name: z.string().min(1),
        credentials: z.record(z.string()),
      })
      .parse(body);
    const provider = providers.find((item) => item.id === input.provider);
    if (!provider && !systemProviders.has(input.provider)) {
      throw new BadRequestException(`Unknown provider ${input.provider}`);
    }
    const missing = (provider?.auth.fields ?? []).filter(
      (field) => field.optional !== true && !input.credentials[field.key]?.trim(),
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing credentials: ${missing.map((field) => field.label).join(', ')}`,
      );
    }
    return await this.prisma.integration.create({
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
  @Roles('admin')
  async test(@Param('id') id: string, @Req() request: Request) {
    const integration = await this.prisma.integration.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!integration) throw new NotFoundException('Integration not found');
    const provider = providers.find((item) => item.id === integration.provider);
    if (!provider) {
      return {
        ok: false,
        provider: integration.provider,
        message: `No live test for the ${integration.provider} provider`,
      };
    }
    const credentials = decryptCredentials(integration.encryptedCredentials);
    const result = await probe(provider, credentials);
    const message =
      result.message ?? (result.ok ? 'Integration test passed' : 'Integration test failed');
    await this.prisma.integration.update({
      where: { id: integration.id },
      data: { lastTestAt: new Date(), lastTestOk: result.ok, lastTestMessage: message },
    });
    return { ok: result.ok, provider: integration.provider, message };
  }

  @Delete(':id')
  @Roles('admin')
  async remove(@Param('id') id: string, @Req() request: Request) {
    const deleted = await this.prisma.integration.deleteMany({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (deleted.count === 0) throw new NotFoundException('Integration not found');
    return { ok: true };
  }

  @Patch(':id')
  @Roles('admin')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() request: Request) {
    const input = z
      .object({ name: z.string().min(1).optional(), credentials: z.record(z.string()).optional() })
      .parse(body);
    const integration = await this.prisma.integration.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!integration) throw new NotFoundException('Integration not found');
    let encryptedCredentials: string | undefined;
    if (input.credentials !== undefined) {
      const current = decryptCredentials(integration.encryptedCredentials);
      const updates = Object.fromEntries(
        Object.entries(input.credentials).filter(([, value]) => value !== ''),
      );
      encryptedCredentials = encryptCredentials({ ...current, ...updates });
    }
    return this.prisma.integration.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(encryptedCredentials === undefined
          ? {}
          : {
              encryptedCredentials,
              lastTestAt: null,
              lastTestOk: null,
              lastTestMessage: null,
            }),
      },
      select: { id: true, provider: true, name: true, createdAt: true, updatedAt: true },
    });
  }
}
