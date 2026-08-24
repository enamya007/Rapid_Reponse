import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { appConfig } from '../../config/app.config';
import { MailModule } from '../mail/mail.module';
import { User } from '../users/entities/user.entity';
import { Notification } from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';

// P6 contract §5 (`docs/plan-P6-contracts.md`): `forFeature` registers EXACTLY `[Notification,
// User]` — `User` is queried read-only for roles/emails/active-state, and this module adds no
// method to `UsersService` nor imports `UsersModule` itself. `Ticket` is deliberately ABSENT for
// the same reason `TechniciansModule` leaves `Category` out of its own `forFeature` (see that
// module's comment): `Notification.ticket` is a real `@ManyToOne` relation, resolved through
// TypeORM's global entity metadata via `relations: { ticket: true }`
// (`NotificationsService.list`) without a repository of its own registered here.
//
// `MailModule` is imported for `MailQueueService` only — the sole provider it exports (D4): no
// SMTP call is reachable from this module, only `enqueue()`.
//
// `ConfigModule.forFeature(appConfig)` mirrors `MailModule`'s own established pattern (see that
// module's comment) so this module's `appConfig.KEY` injection works standalone, without relying
// on `AppModule`'s global `ConfigModule.forRoot({ load: [...] })` having already loaded it.
//
// T6.6 (D17): `NotificationsGateway` is declared here as a plain provider, exactly like
// `NotificationsListener` — both subscribe to events (`ticket.*` / `NOTIFICATION_CREATED`)
// without either being injected into `NotificationsService`, or vice versa. Removing the gateway
// provider below leaves the REST API and the ticket->notification fan-out fully functional.
//
// `JwtModule.register({})` is registered empty on purpose, mirroring `AuthModule`'s own
// documented reasoning for the exact same registration: the gateway passes `accessSecret`
// explicitly to every `verifyAsync` call (`jwtConfig.KEY`, already loaded globally by
// `AppModule`'s `ConfigModule.forRoot({ isGlobal: true, load: [jwtConfig, ...] })` — no local
// `ConfigModule.forFeature(jwtConfig)` needed, `JwtStrategy` relies on that same global loading
// today), so no module-wide secret is configured here either.
@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, User]),
    ConfigModule.forFeature(appConfig),
    JwtModule.register({}),
    MailModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsListener,
    NotificationsGateway,
  ],
})
export class NotificationsModule {}
