import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([RefreshToken, PasswordResetToken]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // Registered empty on purpose: access and refresh tokens use two different secrets/TTLs
    // passed explicitly to every `sign`/`verify` call, so no global secret is configured here.
    JwtModule.register({}),
    // T6.5: only `MailQueueService` is exported by `MailModule` (by design — see its own doc
    // comment), so the password-reset email is always enqueued, never sent synchronously on
    // the HTTP request path (P6 contract §8).
    MailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
