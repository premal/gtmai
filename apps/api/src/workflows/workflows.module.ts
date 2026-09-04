import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WorkflowsController, WorkflowHooksController } from './workflows.controller';

@Module({
  imports: [BullModule.registerQueue({ name: 'workflows' })],
  controllers: [WorkflowsController, WorkflowHooksController],
})
export class WorkflowsModule {}
