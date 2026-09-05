import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UsageController } from './usage.controller';
@Module({ imports: [BullModule.registerQueue({ name: 'usage' })], controllers: [UsageController] })
export class UsageModule {}
