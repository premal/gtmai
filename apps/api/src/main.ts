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
  const config = new DocumentBuilder()
    .setTitle('GTM AI API')
    .setDescription('Workspace-scoped GTM data enrichment API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  let document: OpenAPIObject;
  try {
    document = SwaggerModule.createDocument(app, config, {
      ignoreGlobalPrefix: true,
      include: [AppModule],
    });
  } catch {
    document = SwaggerModule.createDocument(app, config, {
      ignoreGlobalPrefix: true,
      include: [DocsModule],
    });
  }
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
  openApi.paths['/auth/me'] = {
    get: { summary: 'Get the current user', responses: { '200': { description: 'User profile' } } },
  };
  openApi.paths['/connections'] = {
    get: {
      summary: 'List workspace connections',
      responses: { '200': { description: 'Connections' } },
    },
    post: {
      summary: 'Create a provider connection',
      responses: { '201': { description: 'Connection' } },
    },
  };
  openApi.paths['/connections/catalog'] = {
    get: {
      summary: 'List connection fields and providers',
      responses: { '200': { description: 'Catalog' } },
    },
  };
  openApi.paths['/connections/{id}/test'] = {
    post: {
      summary: 'Test a provider connection',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '201': { description: 'Connection test result' } },
    },
  };
  openApi.paths['/connections/{id}'] = {
    delete: {
      summary: 'Delete a provider connection',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Deleted' } },
    },
  };
  openApi.paths['/workspaces/{workspaceId}/tables'] = {
    get: {
      summary: 'List workspace tables',
      parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Tables' } },
    },
    post: {
      summary: 'Create a workspace table',
      parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '201': { description: 'Table' } },
    },
  };
  openApi.paths['/workspaces/{workspaceId}'] = {
    patch: {
      summary: 'Rename a workspace',
      parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Workspace' } },
    },
  };
  openApi.paths['/workspaces/{workspaceId}/members'] = {
    get: {
      summary: 'List workspace members',
      parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Members' } },
    },
  };
  openApi.paths['/tables/{id}/columns'] = {
    post: {
      summary: 'Create a table column',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '201': { description: 'Column' } },
    },
  };
  openApi.paths['/tables/{id}/columns/{columnId}'] = {
    patch: {
      summary: 'Update a table column',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'columnId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'Column' } },
    },
    delete: {
      summary: 'Delete a table column',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'columnId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'Deleted' } },
    },
  };
  openApi.paths['/tables/{id}/rows'] = {
    post: {
      summary: 'Create a table row',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '201': { description: 'Row' } },
    },
  };
  openApi.paths['/tables/{id}/import'] = {
    post: {
      summary: 'Import CSV rows',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '201': { description: 'Import result' } },
    },
  };
  openApi.paths['/tables/{id}/export'] = {
    get: {
      summary: 'Export table CSV',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'CSV export' } },
    },
  };
  openApi.paths['/tables/{id}/rows/{rowId}'] = {
    patch: {
      summary: 'Update a table row',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'rowId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'Row' } },
    },
    delete: {
      summary: 'Delete a table row',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'rowId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'Deleted' } },
    },
  };
  openApi.paths['/tables/{id}/rows/delete'] = {
    post: {
      summary: 'Delete selected table rows',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '201': { description: 'Deleted' } },
    },
  };
  openApi.paths['/tables/{id}/rows/{rowId}/run'] = {
    post: {
      summary: 'Run all columns for a row',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'rowId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { '201': { description: 'Queued cells' } },
    },
  };
  openApi.paths['/tables/{id}/columns/{columnId}/preview'] = {
    post: {
      summary: 'Preview an agent column',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'columnId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { '201': { description: 'Agent previews' } },
    },
  };
  openApi.paths['/tables/{id}/events'] = {
    get: {
      summary: 'Stream live table cell updates',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Server-sent events stream' } },
    },
  };
  openApi.paths['/credits/summary'] = {
    get: { summary: 'Get credit usage summary', responses: { '200': { description: 'Summary' } } },
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
