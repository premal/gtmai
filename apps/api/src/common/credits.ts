import type { PrismaService } from '../prisma/prisma.service';

export async function debitCredits(
  prisma: PrismaService,
  input: {
    workspaceId: string;
    tableId?: string;
    provider?: string;
    credits: number;
    reason: string;
    refType?: string;
    refId?: string;
  },
): Promise<void> {
  if (input.credits <= 0) return;
  const data = {
    workspaceId: input.workspaceId,
    delta: -input.credits,
    reason: input.reason,
    ...(input.tableId ? { tableId: input.tableId } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.refType ? { refType: input.refType } : {}),
    ...(input.refId ? { refId: input.refId } : {}),
  };
  await prisma.creditLedger.create({
    data,
  });
}
