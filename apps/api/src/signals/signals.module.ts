import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SignalsController } from './signals.controller';

@Module({
  imports: [BullModule.registerQueue({ name: 'signals' })],
  controllers: [SignalsController],
})
export class SignalsModule {}
