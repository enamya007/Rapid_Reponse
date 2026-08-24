import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import type { ExecutionContext } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { appConfig, AppConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import { Environment, LogLevel, validate } from './config/env.validation';
import { jwtConfig } from './config/jwt.config';
import { mailConfig } from './config/mail.config';
import { redisConfig, RedisConfig } from './config/redis.config';
import { throttleConfig, ThrottleConfig } from './config/throttle.config';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { buildPinoHttpOptions } from './common/logger/pino-http.options';
import { STRICT_LOGIN_THROTTLE_KEY } from './common/throttle/strict-login-throttle.decorator';
import { dataSourceOptions } from './database/data-source';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { AuthModule } from './modules/auth/auth.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { MailModule } from './modules/mail/mail.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SkillsModule } from './modules/skills/skills.module';
import { SlaModule } from './modules/sla/sla.module';
import { TechniciansModule } from './modules/technicians/technicians.module';
import { TicketCommentsModule } from './modules/ticket-comments/ticket-comments.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      // mailConfig and redisConfig were written in P1 but never loaded here
      // until P6, which is the first phase that actually consumes them
      // (MailService and the BullMQ connection below).
      load: [
        appConfig,
        databaseConfig,
        jwtConfig,
        throttleConfig,
        mailConfig,
        redisConfig,
      ],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () => dataSourceOptions,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const { nodeEnv } = configService.getOrThrow<AppConfig>('app');
        const level = configService.getOrThrow<LogLevel>('LOG_LEVEL');
        return {
          pinoHttp: buildPinoHttpOptions({
            level,
            // JSON in production (machine-readable, shippable to a log aggregator), a
            // human-readable colorized format everywhere else (including tests).
            pretty: nodeEnv !== Environment.Production,
          }),
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, Reflector],
      useFactory: (configService: ConfigService, reflector: Reflector) => {
        const throttle = configService.getOrThrow<ThrottleConfig>('throttle');
        return {
          throttlers: [
            {
              name: 'default',
              ttl: seconds(throttle.ttlSeconds),
              limit: throttle.limit,
            },
            {
              // Dedicated anti-brute-force limiter for the login endpoint (cahier des
              // charges §6.3). Scoped exclusively to routes carrying the
              // `@StrictLoginThrottle()` metadata via `skipIf`, so the rest of the API is
              // governed solely by the 'default' throttler above and is never subject to
              // this much stricter rate.
              name: 'login',
              ttl: seconds(throttle.login.ttlSeconds),
              limit: throttle.login.limit,
              skipIf: (context: ExecutionContext) =>
                reflector.getAllAndOverride<boolean>(
                  STRICT_LOGIN_THROTTLE_KEY,
                  [context.getHandler(), context.getClass()],
                ) !== true,
            },
          ],
        };
      },
    }),
    // P6. Internal event bus: `TicketsService`/`TicketCommentsService` emit
    // ticket.* events after commit (plan-P6-contracts.md D1), and
    // `NotificationsModule` plus the mail listeners subscribe to them.
    // `forRoot()` needs no options -- this project only relies on
    // EventEmitter2's synchronous, in-process defaults (see D3: listeners
    // never propagate, since a synchronous emitter call would otherwise let
    // a failing listener fail the HTTP request that triggered it).
    EventEmitterModule.forRoot(),
    // P6. Global BullMQ connection, shared by every queue registered
    // elsewhere (the `mail` queue itself is wired by a later task via
    // `BullModule.registerQueue`, not here). Built from `redisConfig`
    // -- already loaded above -- instead of re-reading REDIS_* env vars.
    // `maxRetriesPerRequest: null` is required: BullMQ refuses to start
    // without it, since it manages its own retry/backoff strategy for
    // blocking Redis commands instead of delegating that to ioredis.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redis = configService.getOrThrow<RedisConfig>('redis');
        return {
          prefix: 'ticket-checker',
          connection: {
            host: redis.host,
            port: redis.port,
            password: redis.password,
            db: redis.db,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    UsersModule,
    AuthModule,
    TicketsModule,
    // Ticket sub-resources live in their own modules (P4 contract D1/D6) so they stay
    // independent of `TicketsModule`. `StorageModule` is deliberately absent here: it is
    // imported by `AttachmentsModule`, its only consumer, and it loads `storageConfig`
    // itself through `ConfigModule.forFeature` — no need to duplicate either one globally.
    TicketCommentsModule,
    AttachmentsModule,
    // P5. `TechniciansModule` would already be reachable through `TicketsModule`, which
    // imports it for the eligibility and suggestion services, but registering it here keeps
    // the /technicians routes from depending on an import made for another reason.
    SkillsModule,
    TechniciansModule,
    // P6 (T6.2). Registers the `mail` BullMQ queue and starts its `MailProcessor` worker.
    // Without this import the queue is never declared and nothing ever consumes the jobs
    // `MailQueueService.enqueue()` adds elsewhere (notification listeners, password-reset):
    // they would just accumulate in Redis, unprocessed.
    MailModule,
    // P6 (T6.4). `NotificationsListener` subscribes to the `ticket.*` events emitted by
    // `TicketsService`/`TicketCommentsService` above and persists/queues the resulting
    // notifications; `NotificationsController` exposes the D16-scoped REST API. Imported after
    // `MailModule` since it depends on `MailQueueService`.
    NotificationsModule,
    // P6.5. `CategoriesModule` and `SlaModule` expose the two referentials that were seeded and
    // read since P1 but had no route of their own: without `GET /categories` a client cannot
    // fill the category field `POST /tickets` requires, and without `PUT /sla-policies/:priority`
    // the "configurable, pas de constante en dur" SLA table (D6 of `plan-backend.md`) was not
    // actually configurable. `/users` needs no import here: it is a controller added to
    // `UsersModule`, already registered above.
    CategoriesModule,
    SlaModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
