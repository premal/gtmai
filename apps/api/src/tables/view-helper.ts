import { compileFilterPredicate, type Filter } from '@gtmai/shared';

type Column = { id: string };
type Cell = { columnId: string; value: unknown };
type Row = { cells: Cell[]; [key: string]: unknown };
export type ViewSort = { columnId: string; direction: 'asc' | 'desc' };
export type ViewDefinition = {
  filter?: Filter | null;
  sort: ViewSort[];
  hiddenColumnIds: string[];
};

function compareValues(left: unknown, right: unknown): number {
  if (left === null || left === undefined || left === '')
    return right === null || right === undefined || right === '' ? 0 : 1;
  if (right === null || right === undefined || right === '') return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}

export function applyView<T extends Row>(view: ViewDefinition, columns: Column[], rows: T[]): T[] {
  const records = new Map(
    rows.map((row) => [
      row,
      Object.fromEntries(
        columns.map((column) => [
          column.id,
          row.cells.find((cell) => cell.columnId === column.id)?.value,
        ]),
      ),
    ]),
  );
  let visible = view.filter
    ? rows.filter((row) => compileFilterPredicate(view.filter!)(records.get(row)))
    : [...rows];
  if (view.sort.length) {
    visible.sort((left, right) => {
      const leftRecord = records.get(left)!;
      const rightRecord = records.get(right)!;
      for (const sort of view.sort) {
        const leftNull =
          leftRecord[sort.columnId] === null ||
          leftRecord[sort.columnId] === undefined ||
          leftRecord[sort.columnId] === '';
        const rightNull =
          rightRecord[sort.columnId] === null ||
          rightRecord[sort.columnId] === undefined ||
          rightRecord[sort.columnId] === '';
        if (leftNull || rightNull) {
          if (leftNull === rightNull) continue;
          return leftNull ? 1 : -1;
        }
        const result = compareValues(leftRecord[sort.columnId], rightRecord[sort.columnId]);
        if (result) return sort.direction === 'asc' ? result : -result;
      }
      return 0;
    });
  }
  return visible;
}
