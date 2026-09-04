import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { FastifyInstance } from 'fastify';
import { AppModule } from './app.module';

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  app.enableCors({ origin: true });
  const document: OpenAPIObject = {
    openapi: '3.0.0',
    info: { title: 'GTM AI API', version: '1.0' },
    paths: {
      '/auth/register': {
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
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 8 },
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Created' } },
        },
      },
      '/auth/login': {
        post: {
          summary: 'Log in',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Authenticated' } },
        },
      },
      '/providers/catalog': {
        get: { summary: 'List provider actions', responses: { '200': { description: 'Catalog' } } },
      },
      '/tables/{id}': {
        get: {
          summary: 'Get a table with rows and cells',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Table' } },
        },
      },
      '/tables/{id}/columns': {
        post: {
          summary: 'Create a column',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'type', 'kind'],
                  properties: {
                    name: { type: 'string' },
                    type: {
                      type: 'string',
                      enum: ['text', 'number', 'boolean', 'date', 'url', 'email', 'json'],
                    },
                    kind: {
                      type: 'string',
                      enum: [
                        'input',
                        'enrichment',
                        'waterfall',
                        'agent',
                        'formula',
                        'http',
                        'function',
                      ],
                    },
                    config: { type: 'object' },
                    runCondition: { type: 'string' },
                    colorLabel: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Column' } },
        },
      },
      '/tables/{id}/columns/{columnId}/run': {
        post: {
          summary: 'Run a column',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'columnId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '201': { description: 'Queued cells' } },
        },
      },
    },
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    },
  };
  const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
  fastify.get('/docs/openapi.json', async (_request, reply) =>
    reply.type('application/json').send(document),
  );
  fastify.get('/docs', async (_request, reply) =>
    reply
      .type('text/html')
      .send(
        `<!doctype html><html><head><title>GTM AI API</title></head><body><h1>GTM AI API</h1><p>OpenAPI documentation</p><a href="/docs/openapi.json">Download OpenAPI JSON</a></body></html>`,
      ),
  );
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0');
}

if (process.env.NODE_ENV !== 'test') {
  void bootstrap();
}
