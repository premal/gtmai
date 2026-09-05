import { PrismaClient } from '@gtmai/db';
const db = new PrismaClient();
export async function budgetExceeded(
  workspaceId: string,
  estimated: number,
  tableId?: string,
  provider?: string,
) {
  if (estimated <= 0) return false;
  const budgets = await db.creditBudget.findMany({ where: { workspaceId } });
  const now = new Date();
  const periodStart = (period: string) => {
    const date = new Date(now);
    if (period === 'daily') date.setUTCHours(0, 0, 0, 0);
    else date.setUTCDate(1), date.setUTCHours(0, 0, 0, 0);
    return date;
  };
  for (const budget of budgets) {
    const matches =
      budget.scope === 'workspace' ||
      (tableId && budget.scope === `table:${tableId}`) ||
      (provider && budget.scope === `provider:${provider}`);
    if (!matches) continue;
    const spend = await db.creditLedger.aggregate({
      where: { workspaceId, createdAt: { gte: periodStart(budget.period) } },
      _sum: { delta: true },
    });
    if (Math.max(0, -(spend._sum.delta ?? 0)) + estimated > budget.limit) return true;
  }
  return false;
}
