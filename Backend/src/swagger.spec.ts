import { Controller, Get, INestApplication } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  OPENAPI_JSON_SUFFIX,
  OPENAPI_YAML_SUFFIX,
  setupSwagger,
} from './swagger';

class SampleDto {
  @ApiProperty({ example: 'id-1' })
  id: string;
}

@Controller('sample')
class SampleController {
  @Get()
  @ApiOkResponse({ type: SampleDto })
  find(): SampleDto {
    return { id: 'id-1' };
  }
}

const SWAGGER_PATH = 'docs';

// Guards the contract the frontend team depends on: a deployed environment with
// SWAGGER_ENABLED=true must serve the OpenAPI document itself, not just the
// browsable UI, so clients can be generated straight from the running API.
// These routes come from `SwaggerModule`'s own defaults, hence this test —
// it fails loudly if an upgrade or an options change ever drops them.
describe('setupSwagger', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SampleController],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirrors `src/main.ts`: the prefix must be applied before the document is
    // built, otherwise the documented paths omit `/api`.
    app.setGlobalPrefix('api');
    setupSwagger(app, SWAGGER_PATH);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the OpenAPI document as JSON, generated from the code', async () => {
    const response = await request(app.getHttpServer())
      .get(`/${SWAGGER_PATH}${OPENAPI_JSON_SUFFIX}`)
      .expect(200);

    const document = response.body as {
      openapi: string;
      info: { title: string };
      paths: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    };

    expect(document.openapi).toMatch(/^3\./);
    expect(document.info.title).toBe('Ticket Checker API');
    // Routes and schemas are introspected from the decorators, and the paths
    // carry the global prefix a generated client must call.
    expect(document.paths['/api/sample']).toBeDefined();
    expect(document.components?.schemas?.SampleDto).toBeDefined();
  });

  it('serves the same document as YAML', async () => {
    const response = await request(app.getHttpServer())
      .get(`/${SWAGGER_PATH}${OPENAPI_YAML_SUFFIX}`)
      .expect(200);

    expect(response.text).toContain('openapi:');
    expect(response.text).toContain('/api/sample:');
  });

  it('serves the browsable UI', async () => {
    const response = await request(app.getHttpServer())
      .get(`/${SWAGGER_PATH}`)
      .expect(200);

    expect(response.text).toContain('swagger-ui');
  });
});
