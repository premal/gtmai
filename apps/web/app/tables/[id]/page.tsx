'use client';

import { useEffect, useState } from 'react';
import { TableWorkspace } from '../../components/table-workspace';

export default function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const [tableId, setTableId] = useState('');
  useEffect(() => {
    void params.then(({ id }) => setTableId(id));
  }, [params]);
  return tableId ? (
    <TableWorkspace tableId={tableId} />
  ) : (
    <main className="loading">Loading table…</main>
  );
}
