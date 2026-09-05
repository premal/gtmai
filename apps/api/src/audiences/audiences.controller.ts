import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@gtmai/db';
import { z } from 'zod';
import { compileFilterPredicate, filterSchema, type Filter } from '@gtmai/shared';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };
const pageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  q: z.string().optional(),
  filter: z.string().optional(),
});
const companyBody = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),
  data: z.record(z.unknown()).default({}),
});
const contactBody = z.object({
  email: z.string().email().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  companyId: z.string().optional(),
  data: z.record(z.unknown()).default({}),
});
const segmentBody = z.object({ name: z.string().min(1), filter: filterSchema });

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function inferType(value: unknown): string {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return 'date';
  return 'text';
}

export function readMappedValue(value: unknown, field: string): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(object, field) ? object[field] : undefined;
}

function readMappedString(value: unknown, field: string): string | undefined {
  const resolved = readMappedValue(value, field);
  if (typeof resolved !== 'string' && typeof resolved !== 'number') return undefined;
  const result = String(resolved).trim();
  return result || undefined;
}

function parseFilter(value: string | undefined): Filter | undefined {
  if (!value) return undefined;
  return filterSchema.parse(JSON.parse(value));
}

function detectColumnName(
  columns: Array<{ name: string; type: string }>,
  key: string,
): string | undefined {
  const normalized = key.toLowerCase();
  const score = (column: { name: string; type: string }) => {
    const name = column.name.toLowerCase();
    if (normalized === 'email') {
      if (column.type === 'email' && /work\s*e-?mail/i.test(name)) return 5;
      if (column.type === 'email') return 4;
      if (/e-?mail/i.test(name)) return 3;
    }
    if (normalized === 'firstName' && /first/i.test(name)) return 3;
    if (normalized === 'lastName' && /last/i.test(name)) return 3;
    if (normalized === 'domain') {
      if (column.type === 'url') return 3;
      if (/domain|website/i.test(name)) return 2;
    }
    if (normalized === 'companyName' && /company/i.test(name)) return 3;
    return 0;
  };
  return columns
    .map((column, index) => ({ column, score: score(column), index }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.column.name;
}

@Controller('audiences')
@UseGuards(JwtAuthGuard)
export class AudiencesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('companies')
  async companies(@Req() request: Request, @Query() query: Record<string, string>) {
    const input = pageQuery.parse(query);
    const where: Prisma.CompanyWhereInput = { workspaceId: request.user.workspaceId };
    if (input.cursor) where.id = { lt: input.cursor };
    if (input.q) {
      where.OR = [
        { name: { contains: input.q, mode: 'insensitive' } },
        { domain: { contains: input.q, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.company.findMany({
      where,
      orderBy: { id: 'desc' },
      take: input.limit + 1,
      include: { _count: { select: { contacts: true, signalEvents: true } } },
    });
    const filter = parseFilter(input.filter);
    const filtered = filter ? rows.filter(compileFilterPredicate(filter)) : rows;
    const hasMore = filtered.length > input.limit;
    return {
      items: filtered.slice(0, input.limit),
      nextCursor: hasMore ? filtered[input.limit - 1]?.id : null,
    };
  }

  @Post('companies')
  createCompany(@Req() request: Request, @Body() body: unknown) {
    const input = companyBody.parse(body);
    const domainKey = input.domain?.trim().toLowerCase() || undefined;
    const data: Prisma.CompanyCreateInput = {
      workspace: { connect: { id: request.user.workspaceId } },
      name: input.name,
      data: json(input.data),
    };
    if (input.domain !== undefined) data.domain = input.domain;
    if (domainKey) data.domainKey = domainKey;
    return this.prisma.company.create({
      data,
    });
  }

  @Patch('companies/:id')
  updateCompany(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = companyBody.partial().parse(body);
    const data: Prisma.CompanyUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.domain !== undefined) {
      data.domain = input.domain;
      data.domainKey = input.domain.trim().toLowerCase() || null;
    }
    if (input.data !== undefined) data.data = json(input.data);
    return this.prisma.company.update({
      where: { id, workspaceId: request.user.workspaceId },
      data,
    });
  }

  @Delete('companies/:id')
  async deleteCompany(@Req() request: Request, @Param('id') id: string) {
    await this.prisma.company.deleteMany({ where: { id, workspaceId: request.user.workspaceId } });
    return { ok: true };
  }

  @Get('contacts')
  async contacts(@Req() request: Request, @Query() query: Record<string, string>) {
    const input = pageQuery.parse(query);
    const where: Prisma.ContactWhereInput = { workspaceId: request.user.workspaceId };
    if (input.cursor) where.id = { lt: input.cursor };
    if (input.q) {
      where.OR = [
        { email: { contains: input.q, mode: 'insensitive' } },
        { firstName: { contains: input.q, mode: 'insensitive' } },
        { lastName: { contains: input.q, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.contact.findMany({
      where,
      orderBy: { id: 'desc' },
      take: input.limit + 1,
      include: {
        company: true,
        _count: { select: { signalEvents: true } },
        signalEvents: {
          orderBy: { occurredAt: 'desc' },
          take: 20,
          include: { definition: { select: { name: true, type: true } } },
        },
      },
    });
    const filter = parseFilter(input.filter);
    const filtered = filter ? rows.filter(compileFilterPredicate(filter)) : rows;
    const hasMore = filtered.length > input.limit;
    return {
      items: filtered.slice(0, input.limit),
      nextCursor: hasMore ? filtered[input.limit - 1]?.id : null,
    };
  }

  @Post('contacts')
  createContact(@Req() request: Request, @Body() body: unknown) {
    const input = contactBody.parse(body);
    const emailKey = input.email?.trim().toLowerCase() || undefined;
    const data: Prisma.ContactCreateInput = {
      workspace: { connect: { id: request.user.workspaceId } },
      data: json(input.data),
    };
    for (const key of ['email', 'firstName', 'lastName'] as const) {
      const value = input[key];
      if (value !== undefined) data[key] = value;
    }
    if (input.companyId) data.company = { connect: { id: input.companyId } };
    if (emailKey) data.emailKey = emailKey;
    return this.prisma.contact.create({
      data,
    });
  }

  @Patch('contacts/:id')
  updateContact(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = contactBody.partial().parse(body);
    const data: Prisma.ContactUpdateInput = {};
    for (const key of ['email', 'firstName', 'lastName'] as const) {
      if (input[key] !== undefined) data[key] = input[key];
    }
    if (input.companyId !== undefined)
      data.company = input.companyId ? { connect: { id: input.companyId } } : { disconnect: true };
    if (input.email !== undefined) data.emailKey = input.email.trim().toLowerCase() || null;
    if (input.data !== undefined) data.data = json(input.data);
    return this.prisma.contact.update({
      where: { id, workspaceId: request.user.workspaceId },
      data,
    });
  }

  @Delete('contacts/:id')
  async deleteContact(@Req() request: Request, @Param('id') id: string) {
    await this.prisma.contact.deleteMany({ where: { id, workspaceId: request.user.workspaceId } });
    return { ok: true };
  }

  @Post('import/table/:tableId')
  async importTable(
    @Req() request: Request,
    @Param('tableId') tableId: string,
    @Body() body: unknown,
  ) {
    const input = z.object({ mapping: z.record(z.string()).default({}) }).parse(body);
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, workspaceId: request.user.workspaceId },
      include: { columns: true, rows: { include: { cells: true } } },
    });
    if (!table) throw new Error('Table not found');
    const resolveColumn = (key: string): string | undefined =>
      input.mapping[key] ||
      table.columns.find((column) => column.name.toLowerCase() === key.toLowerCase())?.name ||
      detectColumnName(table.columns, key);
    let contactsCreated = 0;
    let contactsUpdated = 0;
    let companiesCreated = 0;
    let companiesUpdated = 0;
    let skipped = 0;
    const companyCache = new Map<string, string>();
    const mappedColumns = new Set(
      ['email', 'firstName', 'lastName', 'companyName', 'domain']
        .map(resolveColumn)
        .filter((name): name is string => Boolean(name)),
    );
    for (const row of table.rows) {
      const values = new Map(
        row.cells.map((cell) => [
          table.columns.find((column) => column.id === cell.columnId)?.name ?? '',
          cell.value,
        ]),
      );
      const get = (key: string) => values.get(resolveColumn(key) ?? '');
      const email = readMappedString(get('email'), 'email')?.toLowerCase();
      if (!email) {
        skipped++;
        continue;
      }
      const firstName = readMappedString(get('firstName'), 'firstName');
      const lastName = readMappedString(get('lastName'), 'lastName');
      const companyName = readMappedString(get('companyName'), 'companyName');
      const rawDomain = readMappedString(get('domain'), 'domain');
      const domain = rawDomain?.replace(/^https?:\/\//, '').split('/')[0];
      let companyId: string | undefined;
      if (domain) {
        const domainKey = domain.toLowerCase();
        companyId = companyCache.get(domainKey);
        if (!companyId) {
          const existing = await this.prisma.company.findFirst({
            where: {
              workspaceId: request.user.workspaceId,
              OR: [{ domainKey }, { domain: { equals: domain, mode: 'insensitive' } }],
            },
          });
          const company = existing
            ? await this.prisma.company.update({
                where: { id: existing.id },
                data: {
                  name: companyName ?? domain,
                  domain,
                  domainKey,
                  data: json({ importedFrom: table.name }),
                },
              })
            : await this.prisma.company.create({
                data: {
                  workspaceId: request.user.workspaceId,
                  name: companyName ?? domain,
                  domain,
                  domainKey,
                  data: json({ importedFrom: table.name }),
                },
              });
          if (existing) companiesUpdated++;
          else companiesCreated++;
          companyId = company.id;
          companyCache.set(domainKey, company.id);
        }
      }
      const mapped: Prisma.ContactUpdateInput = {
        email,
        emailKey: email,
        data: json(Object.fromEntries([...values].filter(([key]) => !mappedColumns.has(key)))),
      };
      if (firstName) mapped.firstName = firstName;
      if (lastName) mapped.lastName = lastName;
      if (companyId) mapped.company = { connect: { id: companyId } };
      const existing = await this.prisma.contact.findFirst({
        where: {
          workspaceId: request.user.workspaceId,
          OR: [{ emailKey: email }, { email: { equals: email, mode: 'insensitive' } }],
        },
      });
      if (existing) {
        await this.prisma.contact.update({ where: { id: existing.id }, data: mapped });
        contactsUpdated++;
      } else {
        await this.prisma.contact.create({
          data: {
            workspace: { connect: { id: request.user.workspaceId } },
            email,
            emailKey: email,
            ...(firstName ? { firstName } : {}),
            ...(lastName ? { lastName } : {}),
            ...(companyId ? { company: { connect: { id: companyId } } } : {}),
            data: mapped.data ?? json({}),
          },
        });
        contactsCreated++;
      }
      for (const [key, value] of values) {
        await this.prisma.fieldDefinition.upsert({
          where: { workspaceId_name: { workspaceId: request.user.workspaceId, name: key } },
          update: { type: inferType(value) },
          create: { workspaceId: request.user.workspaceId, name: key, type: inferType(value) },
        });
      }
    }
    return {
      contactsCreated,
      contactsUpdated,
      companiesCreated,
      companiesUpdated,
      skipped,
      rows: table.rows.length,
    };
  }

  @Post('export/table')
  async exportToTable(@Req() request: Request, @Body() body: unknown) {
    const input = z
      .object({
        name: z.string().min(1),
        segmentId: z.string().optional(),
        filter: filterSchema.optional(),
      })
      .parse(body);
    const contacts = await this.prisma.contact.findMany({
      where: {
        workspaceId: request.user.workspaceId,
        ...(input.segmentId
          ? { segmentMemberships: { some: { segmentId: input.segmentId } } }
          : {}),
      },
      take: 1000,
    });
    const tableId = await this.prisma.$transaction(async (tx) => {
      const table = await tx.table.create({
        data: { workspaceId: request.user.workspaceId, name: input.name },
      });
      const fieldNames = new Set(['email', 'firstName', 'lastName']);
      contacts.forEach((contact) => {
        Object.keys((contact.data as Record<string, unknown>) ?? {}).forEach((name) =>
          fieldNames.add(name),
        );
      });
      const columns = [];
      for (const [position, name] of [...fieldNames].entries()) {
        columns.push(
          await tx.column.create({
            data: {
              tableId: table.id,
              name,
              type: name === 'email' ? 'email' : 'text',
              kind: 'input',
              config: {},
              position,
            },
          }),
        );
      }
      for (const [position, contact] of contacts.entries()) {
        const row = await tx.row.create({ data: { tableId: table.id, position } });
        const data = { ...contact, ...(contact.data as Record<string, unknown>) } as Record<
          string,
          unknown
        >;
        await tx.cell.createMany({
          data: columns.map((column) => ({
            rowId: row.id,
            columnId: column.id,
            value: json(data[column.name] ?? null),
            status: 'done',
          })),
        });
      }
      return table.id;
    });
    return { tableId, rows: contacts.length };
  }

  @Get('segments')
  listSegments(@Req() request: Request) {
    return this.prisma.segment.findMany({
      where: { workspaceId: request.user.workspaceId },
      include: { _count: { select: { memberships: true } } },
      orderBy: { name: 'asc' },
    });
  }

  @Post('segments')
  createSegment(@Req() request: Request, @Body() body: unknown) {
    const input = segmentBody.parse(body);
    return this.prisma.segment.create({
      data: { workspaceId: request.user.workspaceId, name: input.name, filter: json(input.filter) },
    });
  }

  @Patch('segments/:id')
  updateSegment(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = segmentBody.partial().parse(body);
    const data: Prisma.SegmentUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.filter !== undefined) data.filter = json(input.filter);
    return this.prisma.segment.update({
      where: { id, workspaceId: request.user.workspaceId },
      data,
    });
  }

  @Delete('segments/:id')
  async deleteSegment(@Req() request: Request, @Param('id') id: string) {
    await this.prisma.segment.deleteMany({ where: { id, workspaceId: request.user.workspaceId } });
    return { ok: true };
  }

  @Post('segments/:id/refresh')
  async refreshSegment(@Req() request: Request, @Param('id') id: string) {
    const segment = await this.prisma.segment.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
    });
    if (!segment) throw new Error('Segment not found');
    const contacts = await this.prisma.contact.findMany({
      where: { workspaceId: request.user.workspaceId },
      include: { company: true },
    });
    const predicate = compileFilterPredicate(segment.filter as unknown as Filter);
    const matches = contacts.filter((contact) =>
      predicate({ ...contact, data: contact.data, company: contact.company }),
    );
    await this.prisma.segmentMembership.deleteMany({ where: { segmentId: id } });
    await this.prisma.segmentMembership.createMany({
      data: matches.map((contact) => ({ segmentId: id, contactId: contact.id })),
    });
    return { segmentId: id, count: matches.length };
  }

  @Get('segments/:id/contacts')
  segmentContacts(@Req() request: Request, @Param('id') id: string) {
    return this.prisma.contact.findMany({
      where: {
        workspaceId: request.user.workspaceId,
        segmentMemberships: { some: { segmentId: id } },
      },
      include: { company: true },
    });
  }
}
