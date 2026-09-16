import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TablesController } from './tables.controller';
import { ViewsController } from './views.controller';

@Module({
  imports: [BullModule.registerQueue({ name: 'cells' })],
  controllers: [TablesController, ViewsController],
})
export class TablesModule {}
