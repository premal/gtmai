import { Prisma } from '@gtmai/db';
import type { PrismaService } from '../prisma/prisma.service';

type RowColumn = { id: string; kind: string };

export async function createRowWithValues(
  prisma: PrismaService,
  tableId: string,
  columns: RowColumn[],
  values: Record<string, unknown>,
  position: number,
) {
  const row = await prisma.row.create({ data: { tableId, position } });
  await prisma.$transaction(
    columns.map((column) => {
      const value = values[column.id];
      if (column.kind === 'input') {
        return prisma.cell.create({
          data: {
            rowId: row.id,
            columnId: column.id,
            value: value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue),
            status: 'done',
          },
        });
      }
      return prisma.cell.create({
        data:
          value === undefined
            ? { rowId: row.id, columnId: column.id, status: 'skipped' }
            : {
                rowId: row.id,
                columnId: column.id,
                value: value as Prisma.InputJsonValue,
                status: 'done',
              },
      });
    }),
  );
  return row;
}
