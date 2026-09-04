import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import multipart from '@fastify/multipart';
import { AppModule } from './app.module';
import { DocsModule } from './docs.module';

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  await app.register(multipart);
  app.enableCors({ origin: true });
  return app;
}

function setupSwagger(app: NestFastifyApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('GTM AI API')
      .setDescription('Workspace-scoped GTM data enrichment API')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
    { ignoreGlobalPrefix: true, include: [DocsModule] },
  );
  const openApi = document as OpenAPIObject;
  openApi.paths['/auth/login'] = {
    post: {
      summary: 'Log in',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'password'],
              properties: { email: { type: 'string' }, password: { type: 'string' } },
            },
          },
        },
      },
      responses: { '201': { description: 'Authenticated' } },
    },
  };
  openApi.paths['/auth/register'] = {
    post: {
      summary: 'Register a user and workspace',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'password', 'name'],
              properties: {
                email: { type: 'string' },
                password: { type: 'string' },
                name: { type: 'string' },
              },
            },
          },
        },
      },
      responses: { '201': { description: 'Created' } },
    },
  };
  openApi.paths['/providers/catalog'] = {
    get: { summary: 'List provider actions', responses: { '200': { description: 'Catalog' } } },
  };
  openApi.paths['/tables/{id}'] = {
    get: {
      summary: 'Get a table with rows and cells',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Table' } },
    },
  };
  openApi.paths['/tables/{id}/columns/{columnId}/run'] = {
    post: {
      summary: 'Queue a column run',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'columnId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { '201': { description: 'Queued cells' } },
    },
  };
  openApi.paths['/credits'] = {
    get: {
      summary: 'Get paginated credit ledger',
      responses: { '200': { description: 'Credit ledger page' } },
    },
  };
  openApi.paths['/formula/preview'] = {
    post: {
      summary: 'Preview a formula against a row',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['expression', 'row'],
              properties: {
                expression: { type: 'string' },
                row: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
      },
      responses: { '201': { description: 'Formula preview result' } },
    },
  };
  SwaggerModule.setup('docs', app, document, { useGlobalPrefix: false, explorer: true });
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  setupSwagger(app);
  await app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0');
}

if (process.env.NODE_ENV !== 'test') {
  void bootstrap();
}
