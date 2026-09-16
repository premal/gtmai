import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CrmController } from './crm.controller';
@Module({ imports: [BullModule.registerQueue({ name: 'crm' })], controllers: [CrmController] })
export class CrmModule {}
