import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { createOpenApiDocument } from '../src/swagger';

// Dumps the OpenAPI document to a file without booting a real server.
//
// This is only a convenience for offline/CI use (e.g. diffing the spec): the
// document the frontend actually consumes is served live by the deployed API
// at `SWAGGER_PATH-json` / `-yaml`. Both go through `createOpenApiDocument`,
// so they describe the same API.
//
// `preview: true` builds the module graph from metadata alone: no provider or
// controller is instantiated and no lifecycle hook runs, so Postgres/Redis/S3
// are never contacted. Swagger only reads decorator metadata off the
// controller classes, which is fully available in that mode.
async function generateOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
  });

  // Mirrors `src/main.ts`, and must stay before the document is created so the
  // emitted paths carry the `/api` prefix.
  app.setGlobalPrefix('api');

  const document = createOpenApiDocument(app);

  const outputPath = resolve(process.cwd(), process.argv[2] ?? 'openapi.json');
  writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  await app.close();

  const pathCount = Object.keys(document.paths ?? {}).length;
  const schemaCount = Object.keys(document.components?.schemas ?? {}).length;
  console.log(
    `OpenAPI written to ${outputPath} (${pathCount} paths, ${schemaCount} schemas)`,
  );
}

generateOpenApi().catch((error: unknown) => {
  console.error('Failed to generate the OpenAPI document', error);
  process.exitCode = 1;
});
