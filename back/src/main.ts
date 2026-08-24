import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger, LoggerErrorInterceptor } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfig } from './config/app.config';
import {
  OPENAPI_JSON_SUFFIX,
  OPENAPI_YAML_SUFFIX,
  setupSwagger,
} from './swagger';

function resolveCorsOrigin(corsOrigins: string): boolean | string[] {
  const trimmed = corsOrigins.trim();
  if (trimmed === '*') {
    return true;
  }
  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

async function bootstrap(): Promise<void> {
  // `bufferLogs` holds every log emitted during startup (before `useLogger` below runs) in
  // memory instead of dropping it, then flushes it all through Pino once it is wired up.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Replaces Nest's default console logger with Pino app-wide (including every `new
  // Logger(...)` call below and throughout the codebase), and makes framework-level error
  // logging (uncaught exceptions in the request lifecycle) go through Pino's structured
  // `err` serializer instead of a plain two-argument `.error(message, trace)` call it does
  // not understand.
  app.useLogger(app.get(PinoLogger));
  app.useGlobalInterceptors(new LoggerErrorInterceptor());

  const configService = app.get(ConfigService);
  const appConfiguration = configService.getOrThrow<AppConfig>('app');

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: resolveCorsOrigin(appConfiguration.corsOrigins),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Must run after `setGlobalPrefix` above so the emitted paths carry `/api`.
  if (appConfiguration.swaggerEnabled) {
    setupSwagger(app, appConfiguration.swaggerPath);
  }

  app.enableShutdownHooks();

  await app.listen(appConfiguration.port);

  const logger = new Logger('Bootstrap');
  const appUrl = await app.getUrl();
  logger.log(`Application is listening on: ${appUrl}/api`);
  if (appConfiguration.swaggerEnabled) {
    const swaggerUrl = `${appUrl}/${appConfiguration.swaggerPath}`;
    logger.log(`Swagger UI available at: ${swaggerUrl}`);
    // Logged explicitly: these are the URLs the frontend team consumes for
    // client generation, and they are not discoverable from the UI itself.
    logger.log(
      `OpenAPI document available at: ${swaggerUrl}${OPENAPI_JSON_SUFFIX} (JSON) and ${swaggerUrl}${OPENAPI_YAML_SUFFIX} (YAML)`,
    );
  }
}

bootstrap().catch((error: unknown) => {
  // `app.useLogger` may not even have run yet if startup failed early (e.g. env
  // validation), so this deliberately falls back to Nest's plain default logger rather than
  // relying on Pino being wired up.
  const logger = new Logger('Bootstrap');
  logger.error(
    'Application failed to start',
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
});
