import { Queue, Worker, type Job } from 'bullmq';
import { PrismaClient, Prisma } from '@gtmai/db';
const db = new PrismaClient();
const connection = {
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  maxRetriesPerRequest: null,
};
export type UsageJob = { workspaceId: string };
export async function rollupUsage(workspaceId: string) {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const entries = await db.creditLedger.findMany({
    where: { workspaceId, createdAt: { gte: since }, delta: { lt: 0 } },
  });
  const byDay = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.createdAt.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + -entry.delta);
  }
  for (const [key, credits] of byDay) {
    const period = new Date(`${key}T00:00:00.000Z`);
    const existing = await db.usageSnapshot.findFirst({
      where: { workspaceId, tableId: null, period },
    });
    if (existing) await db.usageSnapshot.update({ where: { id: existing.id }, data: { credits } });
    else await db.usageSnapshot.create({ data: { workspaceId, period, credits } });
  }
  const hourStart = new Date(Date.now() - 3_600_000);
  const lastHour = entries
    .filter((entry) => entry.createdAt >= hourStart)
    .reduce((sum, entry) => sum - entry.delta, 0);
  const sevenDays = await db.creditLedger.findMany({
    where: {
      workspaceId,
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 3_600_000), lt: hourStart },
      delta: { lt: 0 },
    },
  });
  const average = sevenDays.reduce((sum, entry) => sum - entry.delta, 0) / 167;
  if (lastHour > 50 && lastHour > average * 3) {
    const alert = await db.alert.create({
      data: {
        workspaceId,
        type: 'usage_spike',
        message: `Usage spike: ${lastHour.toFixed(1)} credits in the last hour`,
        metadata: { lastHour, average } as Prisma.InputJsonValue,
      },
    });
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
  return {
    snapshots: byDay.size,
    credits: [...byDay.values()].reduce((sum, value) => sum + value, 0),
  };
}
export function startUsageWorker() {
  const queue = new Queue('usage', { connection });
  void db.workspace
    .findMany({ select: { id: true } })
    .then((workspaces) =>
      Promise.all(
        workspaces.map((workspace) =>
          queue.add(
            'rollup',
            { workspaceId: workspace.id },
            { repeat: { every: 86_400_000 }, jobId: `usage-nightly:${workspace.id}` },
          ),
        ),
      ),
    );
  return new Worker<UsageJob>('usage', (job) => rollupUsage(job.data.workspaceId), {
    connection,
    concurrency: 1,
  });
}
