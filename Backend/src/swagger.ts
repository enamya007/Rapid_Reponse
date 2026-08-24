import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

// Suffixes appended by SwaggerModule to the configured Swagger path to serve
// the raw document (its own defaults for `jsonDocumentUrl`/`yamlDocumentUrl`).
// Named here so main.ts can log the exact URLs, and tests can assert them,
// without re-typing the strings.
export const OPENAPI_JSON_SUFFIX = '-json';
export const OPENAPI_YAML_SUFFIX = '-yaml';

/**
 * The single source of truth for the API's OpenAPI metadata: used both by the
 * running application (`setupSwagger` below) and by the offline generator
 * (`scripts/generate-openapi.ts`), so the two can never drift apart.
 */
export function buildOpenApiConfig(): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
    .setTitle('Ticket Checker API')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .build();
}

/**
 * Builds the OpenAPI document by introspecting the running application: every
 * route, DTO and schema comes from the decorators in the code itself, so the
 * served document can never fall out of sync with the deployed build.
 *
 * Call this AFTER `setGlobalPrefix`, otherwise the emitted paths lack the
 * `/api` prefix and generated clients hit 404s.
 */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(app, buildOpenApiConfig());
}

/**
 * Mounts the Swagger UI at `path` plus the raw document at `path-json` and
 * `path-yaml`, so the frontend team can pull the spec straight from a deployed
 * environment (codegen, client generation) without anyone exporting a file by
 * hand.
 *
 * Note: these routes are registered directly on the HTTP adapter by
 * `SwaggerModule`, so they bypass the global `/api` prefix and every global
 * guard/interceptor -- including ThrottlerGuard. Whether they should be
 * reachable at all is therefore governed solely by SWAGGER_ENABLED.
 */
export function setupSwagger(
  app: INestApplication,
  path: string,
): OpenAPIObject {
  const document = createOpenApiDocument(app);

  SwaggerModule.setup(path, app, document, {
    // Both are SwaggerModule defaults; stated explicitly because serving the
    // raw JSON/YAML is a deliberate contract with the frontend team, not an
    // incidental side effect that may be silently dropped on an upgrade.
    ui: true,
    raw: ['json', 'yaml'],
    swaggerOptions: { persistAuthorization: true },
  });

  return document;
}
