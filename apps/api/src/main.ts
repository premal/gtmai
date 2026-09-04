import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  app.enableCors({ origin: true });
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('GTM AI API').setVersion('1.0').build(),
  );
  SwaggerModule.setup('docs', app, document);
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0');
}

if (process.env.NODE_ENV !== 'test') {
  void bootstrap();
}
