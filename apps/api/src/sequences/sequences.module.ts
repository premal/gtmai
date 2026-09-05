import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { InboxesController, SequencesController } from './sequences.controller';
import { CampaignsController } from './campaigns.controller';

@Module({
  imports: [BullModule.registerQueue({ name: 'outbound' })],
  controllers: [InboxesController, SequencesController, CampaignsController],
})
export class SequencesModule {}
