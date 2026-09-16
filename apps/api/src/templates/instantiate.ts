import { Prisma } from '@gtmai/db';
import { createRowWithValues } from '../tables/row-helper';
import type { PrismaService } from '../prisma/prisma.service';
import { getOrCreateDefaultWorkbook } from '../common/workbooks';

export type TableTemplateDefinition = {
  columns?: Array<{
    name: string;
    kind?: string;
    type?: string;
    config?: Record<string, unknown>;
  }>;
  rows?: Array<Record<string, unknown>>;
};

const json = (value: unknown) => value as Prisma.InputJsonValue;

export async function instantiateTableTemplate(
  prisma: PrismaService,
  workspaceId: string,
  name: string,
  definition: TableTemplateDefinition,
  workbookId?: string,
) {
  const workbook = workbookId
    ? await prisma.workbook.findFirstOrThrow({ where: { id: workbookId, workspaceId } })
    : await getOrCreateDefaultWorkbook(prisma, workspaceId);
  const position = await prisma.table.count({ where: { workbookId: workbook.id } });
  const table = await prisma.table.create({
    data: { workspaceId, workbookId: workbook.id, name, position },
  });
  const columns = [];
  for (const [position, column] of (definition.columns ?? []).entries()) {
    columns.push(
      await prisma.column.create({
        data: {
          tableId: table.id,
          name: column.name,
          kind: (column.kind ?? 'input') as 'input',
          type: (column.type ?? 'text') as 'text',
          config: json(column.config ?? {}),
          position,
        },
      }),
    );
  }
  for (const [position, values] of (definition.rows ?? []).entries()) {
    const cellValues = Object.fromEntries(
      columns.map((column) => [column.id, values[column.name]]),
    );
    await createRowWithValues(prisma, table.id, columns, cellValues, position);
  }
  return { table, columns };
}
