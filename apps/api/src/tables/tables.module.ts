import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TablesController } from './tables.controller';

@Module({
  imports: [BullModule.registerQueue({ name: 'cells' })],
  controllers: [TablesController],
})
export class TablesModule {}
