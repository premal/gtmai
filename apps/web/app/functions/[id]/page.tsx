'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function FunctionDetailPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/functions');
  }, [router]);
  return <div className="content empty-state">Loading function editor…</div>;
}
