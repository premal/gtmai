import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TablesController } from './tables.controller';
import { ViewsController } from './views.controller';
import { WorkbookResourceGuard } from '../common/workbook-resource.guard';

@Module({
  imports: [BullModule.registerQueue({ name: 'cells' })],
  controllers: [TablesController, ViewsController],
  providers: [WorkbookResourceGuard],
})
export class TablesModule {}
