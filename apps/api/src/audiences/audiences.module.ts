import { Module } from '@nestjs/common';
import { AudiencesController } from './audiences.controller';

@Module({
  controllers: [AudiencesController],
})
export class AudiencesModule {}
