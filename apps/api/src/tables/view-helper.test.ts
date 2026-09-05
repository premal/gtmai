import { describe, expect, it } from 'vitest';
import { applyView } from './view-helper';

describe('applyView', () => {
  const columns = [{ id: 'name' }, { id: 'score' }];
  const rows = [
    {
      id: 'a',
      cells: [
        { columnId: 'name', value: 'beta' },
        { columnId: 'score', value: 2 },
      ],
    },
    {
      id: 'b',
      cells: [
        { columnId: 'name', value: 'Alpha' },
        { columnId: 'score', value: null },
      ],
    },
    {
      id: 'c',
      cells: [
        { columnId: 'name', value: 'gamma' },
        { columnId: 'score', value: 10 },
      ],
    },
  ];

  it('filters by column id and sorts case-insensitively', () => {
    const result = applyView(
      {
        filter: { field: 'name', op: 'contains', value: 'a' },
        sort: [{ columnId: 'name', direction: 'desc' }],
        hiddenColumnIds: ['score'],
      },
      columns,
      rows,
    );
    expect(result.map((row) => row.id)).toEqual(['c', 'a', 'b']);
    expect(result[0]?.cells).toHaveLength(2);
  });

  it('sorts numbers and places nulls last in either direction', () => {
    expect(
      applyView(
        { filter: null, sort: [{ columnId: 'score', direction: 'asc' }], hiddenColumnIds: [] },
        columns,
        rows,
      ).map((row) => row.id),
    ).toEqual(['a', 'c', 'b']);
    expect(
      applyView(
        { filter: null, sort: [{ columnId: 'score', direction: 'desc' }], hiddenColumnIds: [] },
        columns,
        rows,
      ).map((row) => row.id),
    ).toEqual(['c', 'a', 'b']);
  });
});
