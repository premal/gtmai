import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdsController } from './ads.controller';

@Module({
  imports: [BullModule.registerQueue({ name: 'ads' })],
  controllers: [AdsController],
})
export class AdsModule {}
