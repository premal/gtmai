import { Module } from '@nestjs/common';
import { WorkbooksController } from './workbooks.controller';

@Module({ controllers: [WorkbooksController] })
export class WorkbooksModule {}
