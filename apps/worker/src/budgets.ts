import { Prisma, PrismaClient } from '@gtmai/db';
const db = new PrismaClient();

export function budgetMatches(scope: string, tableId?: string, provider?: string) {
  return (
    scope === 'workspace' ||
    Boolean(tableId && scope === `table:${tableId}`) ||
    Boolean(provider && scope === `provider:${provider}`)
  );
}

export function ledgerScopeFilter(scope: string, tableId?: string, provider?: string) {
  if (scope.startsWith('table:')) return { tableId: tableId ?? scope.slice('table:'.length) };
  if (scope.startsWith('provider:')) {
    return { provider: provider ?? scope.slice('provider:'.length) };
  }
  return {};
}

export function spendExceedsBudget(spend: number, estimated: number, limit: number) {
  return Math.max(0, -spend) + estimated > limit;
}

async function notifyBudgetExceeded(
  workspaceId: string,
  scope: string,
  period: string,
  periodStart: Date,
) {
  const dedupeKey = `budget_exceeded:${workspaceId}:${scope}:${periodStart.toISOString()}`;
  const existing = await db.alert.findUnique({ where: { dedupeKey } });
  if (existing) return;
  let alert;
  try {
    alert = await db.alert.create({
      data: {
        workspaceId,
        dedupeKey,
        type: 'budget_exceeded',
        message: `Budget exceeded for ${scope} (${period})`,
        metadata: { scope, period, periodStart: periodStart.toISOString() },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
    throw error;
  }
  const channels = await db.alertChannel.findMany({
    where: { workspaceId, enabled: true, type: 'webhook' },
  });
  await Promise.all(
    channels.map((channel) =>
      fetch(channel.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(alert),
      }).catch(() => undefined),
    ),
  );
}

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
    else {
      date.setUTCDate(1);
      date.setUTCHours(0, 0, 0, 0);
    }
    return date;
  };
  for (const budget of budgets) {
    if (!budgetMatches(budget.scope, tableId, provider)) continue;
    const spend = await db.creditLedger.aggregate({
      where: {
        workspaceId,
        createdAt: { gte: periodStart(budget.period) },
        ...ledgerScopeFilter(budget.scope, tableId, provider),
      },
      _sum: { delta: true },
    });
    if (spendExceedsBudget(spend._sum.delta ?? 0, estimated, budget.limit)) {
      await notifyBudgetExceeded(
        workspaceId,
        budget.scope,
        budget.period,
        periodStart(budget.period),
      );
      return true;
    }
  }
  return false;
}
