import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@gtmai/db';
import type { Queue } from 'bullmq';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

type Request = FastifyRequest & { user: AuthUser };
const json = (value: unknown) => value as Prisma.InputJsonValue;
const campaignSchema = z.object({
  name: z.string().min(1),
  sequenceId: z.string(),
  segmentId: z.string().optional(),
  contactIds: z.array(z.string()).default([]),
});

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @InjectQueue('outbound') private readonly queue: Queue,
  ) {}

  @Get()
  async list(@Req() request: Request) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { workspaceId: request.user.workspaceId },
      include: {
        sequence: { include: { steps: { orderBy: { position: 'asc' } } } },
        _count: { select: { enrollments: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return Promise.all(
      campaigns.map(async (campaign) => {
        const [sent, replied] = await Promise.all([
          this.prisma.message.count({
            where: { enrollment: { campaignId: campaign.id }, status: 'sent' },
          }),
          this.prisma.enrollment.count({ where: { campaignId: campaign.id, status: 'replied' } }),
        ]);
        return {
          ...campaign,
          stats: { enrolled: campaign._count.enrollments, sent, replied },
        };
      }),
    );
  }

  @Get(':id')
  get(@Req() request: Request, @Param('id') id: string) {
    return this.prisma.campaign.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
      include: {
        sequence: { include: { steps: { orderBy: { position: 'asc' } }, inbox: true } },
        enrollments: {
          include: {
            contact: { include: { company: true } },
            messages: { orderBy: { sentAt: 'asc' }, include: { replies: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
  }

  @Post()
  async create(@Req() request: Request, @Body() body: unknown) {
    const input = campaignSchema.parse(body);
    const sequence = await this.prisma.sequence.findFirst({
      where: { id: input.sequenceId, workspaceId: request.user.workspaceId },
    });
    if (!sequence) throw new Error('Sequence not found');
    const segmentContacts = input.segmentId
      ? await this.prisma.segmentMembership.findMany({
          where: { segmentId: input.segmentId, segment: { workspaceId: request.user.workspaceId } },
          select: { contactId: true },
        })
      : [];
    const contactIds = [
      ...new Set([...input.contactIds, ...segmentContacts.map((item) => item.contactId)]),
    ];
    const contacts = await this.prisma.contact.findMany({
      where: { id: { in: contactIds }, workspaceId: request.user.workspaceId },
      select: { id: true },
    });
    return this.prisma.campaign.create({
      data: {
        workspaceId: request.user.workspaceId,
        name: input.name,
        sequenceId: input.sequenceId,
        ...(input.segmentId ? { segmentId: input.segmentId } : {}),
        status: 'draft',
        enrollments: {
          create: contacts.map((contact) => ({ contactId: contact.id, status: 'active' })),
        },
      },
      include: { enrollments: true },
    });
  }

  @Post(':id/start')
  async start(@Req() request: Request, @Param('id') id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, workspaceId: request.user.workspaceId },
      include: {
        sequence: { include: { steps: { orderBy: { position: 'asc' } } } },
        enrollments: true,
      },
    });
    if (!campaign) throw new Error('Campaign not found');
    const first = campaign.sequence.steps[0];
    if (!first) throw new Error('Sequence has no steps');
    await this.prisma.campaign.update({ where: { id }, data: { status: 'active' } });
    for (const enrollment of campaign.enrollments.filter((item) => item.status === 'active')) {
      await this.queue.add(
        'campaign-step',
        {
          enrollmentId: enrollment.id,
          stepPosition: first.position,
          workspaceId: request.user.workspaceId,
        },
        { jobId: `outbound:${enrollment.id}:${first.position}` },
      );
    }
    return { ok: true, queued: campaign.enrollments.length };
  }

  @Post(':id/pause')
  async pause(@Req() request: Request, @Param('id') id: string) {
    await this.prisma.campaign.updateMany({
      where: { id, workspaceId: request.user.workspaceId },
      data: { status: 'paused' },
    });
    return { ok: true };
  }

  @Post(':id/replies/ingest')
  async ingestReply(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = z.object({ enrollmentId: z.string(), body: z.string().min(1) }).parse(body);
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        id: input.enrollmentId,
        campaignId: id,
        campaign: { workspaceId: request.user.workspaceId },
      },
      include: { messages: { orderBy: { sentAt: 'desc' } } },
    });
    if (!enrollment) throw new Error('Enrollment not found');
    const latest =
      enrollment.messages[0] ??
      (await this.prisma.message.create({
        data: {
          enrollmentId: enrollment.id,
          direction: 'inbound',
          subject: '',
          body: '',
          status: 'sent',
        },
      }));
    const reply = await this.prisma.reply.create({
      data: { messageId: latest.id, body: input.body, receivedAt: new Date() },
    });
    await this.prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { status: 'replied', nextStepAt: null },
    });
    const jobs = await this.queue.getJobs(['delayed', 'waiting', 'prioritized']);
    await Promise.all(
      jobs.filter((job) => job.data?.enrollmentId === enrollment.id).map((job) => job.remove()),
    );
    return reply;
  }
}
