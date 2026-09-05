import { Queue, Worker, type Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { PrismaClient } from '@gtmai/db';
import { renderSequenceTemplate } from '@gtmai/shared';
import { decryptCredentials } from './executors';

const db = new PrismaClient();
const connection = {
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  maxRetriesPerRequest: null,
};
const queue = new Queue('outbound', { connection });

export type CampaignStepJob = {
  enrollmentId: string;
  stepPosition: number;
  workspaceId: string;
};
export function nextStepDelayMs(delayHours: number) {
  return Math.max(0, delayHours) * 3_600_000;
}

export async function executeCampaignStep(job: Job<CampaignStepJob>): Promise<void> {
  const enrollment = await db.enrollment.findFirst({
    where: { id: job.data.enrollmentId, campaign: { workspaceId: job.data.workspaceId } },
    include: {
      contact: { include: { company: true } },
      campaign: {
        include: {
          sequence: { include: { steps: { orderBy: { position: 'asc' } }, inbox: true } },
        },
      },
    },
  });
  if (!enrollment || enrollment.status !== 'active' || enrollment.campaign.status !== 'active')
    return;
  const step = enrollment.campaign.sequence.steps.find(
    (item) => item.position === job.data.stepPosition,
  );
  if (!step) return;
  const inbox = enrollment.campaign.sequence.inbox;
  const context = {
    firstName: enrollment.contact.firstName,
    lastName: enrollment.contact.lastName,
    email: enrollment.contact.email,
    data: enrollment.contact.data,
  };
  const subject = renderSequenceTemplate(step.subjectTemplate, context, enrollment.contact.company);
  const body = renderSequenceTemplate(step.bodyTemplate, context, enrollment.contact.company);
  const message = await db.message.create({
    data: {
      enrollmentId: enrollment.id,
      direction: 'outbound',
      subject,
      body,
      status: 'queued',
      stepPosition: step.position,
    },
  });
  try {
    const config = (inbox?.config ?? {}) as Record<string, unknown>;
    const provider = String(config.provider ?? 'mock');
    if (provider === 'smtp') {
      const connectionId =
        typeof config.connectionId === 'string' ? config.connectionId : undefined;
      const smtp = await db.connection.findFirst({
        where: {
          workspaceId: job.data.workspaceId,
          provider: 'smtp',
          ...(connectionId ? { id: connectionId } : {}),
        },
      });
      if (!smtp) throw new Error('No connection for smtp');
      const credentials = decryptCredentials(smtp.encryptedCredentials);
      const transport = nodemailer.createTransport({
        host: credentials.host,
        port: Number(credentials.port ?? 587),
        secure: credentials.secure === 'true',
        auth: credentials.user ? { user: credentials.user, pass: credentials.password } : undefined,
      });
      await transport.sendMail({
        from: String(config.from ?? credentials.from ?? credentials.user),
        to: enrollment.contact.email ?? '',
        subject,
        text: body,
      });
    } else if (provider !== 'mock') {
      throw new Error(`Unsupported inbox provider ${provider}`);
    }
    await db.message.update({
      where: { id: message.id },
      data: { status: 'sent', sentAt: new Date(), error: null },
    });
    const next = enrollment.campaign.sequence.steps
      .filter((candidate) => candidate.position > step.position)
      .sort((a, b) => a.position - b.position)[0];
    if (next) {
      const nextStepAt = new Date(Date.now() + next.delayHours * 3_600_000);
      await db.enrollment.update({ where: { id: enrollment.id }, data: { nextStepAt } });
      await queue.add(
        'campaign-step',
        {
          enrollmentId: enrollment.id,
          stepPosition: next.position,
          workspaceId: job.data.workspaceId,
        },
        {
          jobId: `outbound:${enrollment.id}:${next.position}`,
          delay: nextStepDelayMs(next.delayHours),
        },
      );
    } else {
      await db.enrollment.update({
        where: { id: enrollment.id },
        data: { status: 'completed', nextStepAt: null },
      });
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Message send failed';
    await db.message.update({
      where: { id: message.id },
      data: { status: 'failed', error: messageText },
    });
    await db.enrollment.update({
      where: { id: enrollment.id },
      data: { status: 'bounced', nextStepAt: null },
    });
    throw error;
  }
}

export function startOutboundWorker() {
  return new Worker<CampaignStepJob>('outbound', executeCampaignStep, {
    connection,
    concurrency: 4,
  });
}
