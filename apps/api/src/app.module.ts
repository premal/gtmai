import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { ConnectionsModule } from './connections/connections.module';
import { CreditsModule } from './credits/credits.module';
import { EventsModule } from './events/events.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProvidersModule } from './providers/providers.module';
import { TablesModule } from './tables/tables.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { AudiencesModule } from './audiences/audiences.module';
import { SignalsModule } from './signals/signals.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { FunctionsModule } from './functions/functions.module';
import { TemplatesModule } from './templates/templates.module';
import { FormulaController } from './formula.controller';
import { DocsModule } from './docs.module';
import { SequencesModule } from './sequences/sequences.module';
import { AdsModule } from './ads/ads.module';
import { CrmModule } from './crm/crm.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { UsageModule } from './usage/usage.module';

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV !== 'test') {
    throw new Error(`${name} is required`);
  }
  return value ?? `test-${name.toLowerCase()}`;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: () => ({
        JWT_SECRET: required('JWT_SECRET'),
        ENCRYPTION_KEY: required('ENCRYPTION_KEY'),
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
        },
      }),
    }),
    BullModule.registerQueue(
      { name: 'signals' },
      { name: 'workflows' },
      { name: 'outbound' },
      { name: 'ads' },
      { name: 'crm' },
      { name: 'usage' },
    ),
    PrismaModule,
    AuthModule,
    WorkspacesModule,
    ConnectionsModule,
    TablesModule,
    ProvidersModule,
    CreditsModule,
    EventsModule,
    DocsModule,
    AudiencesModule,
    SignalsModule,
    WorkflowsModule,
    FunctionsModule,
    TemplatesModule,
    SequencesModule,
    AdsModule,
    CrmModule,
    ApiKeysModule,
    UsageModule,
  ],
  controllers: [FormulaController],
})
export class AppModule {}
