import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { isUUID } from 'class-validator';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { isUniqueViolation } from '../../common/database/unique-violation.util';
import {
  ARGON2_OPTIONS,
  hashPassword,
  verifyPassword,
} from '../../common/security/password.util';
import { appConfig } from '../../config/app.config';
import type { AppConfig } from '../../config/app.config';
import { jwtConfig } from '../../config/jwt.config';
import type { JwtConfig } from '../../config/jwt.config';
import { MailQueueService } from '../mail/mail-queue.service';
import { passwordResetMail } from '../mail/templates/password-reset.template';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { JwtPayload, RefreshTokenPayload } from './types/jwt-payload.type';

// P6 contract §8: "TTL : 1 heure exactement" (cahier des charges §4.1, "expirant sous 1
// heure"). Named constants instead of a literal buried in `issueResetToken`/the mail call, so
// the token's actual lifetime and what the email tells the user to always agree.
const PASSWORD_RESET_TOKEN_TTL_MINUTES = 60;
const PASSWORD_RESET_TOKEN_TTL_MS =
  PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000;

// D13: the exact same body `forgotPassword` returns whether or not the account exists (or is
// active). A single constant, rather than one literal per call site, makes it structurally
// impossible for the "account exists" and "account doesn't exist" paths to drift apart.
const FORGOT_PASSWORD_RESPONSE = {
  message: 'If the account exists, a reset link has been sent.',
};

// D12: the exact same 400 for every failure mode of `resetPassword` (malformed token, unknown
// row, already used, expired, wrong secret, disabled account). One constant, thrown from every
// branch below, instead of one hand-written message per branch that a future edit could nudge
// out of sync and accidentally start leaking which case actually happened.
const INVALID_OR_EXPIRED_TOKEN_MESSAGE = 'Invalid or expired token';

// Pre-computed argon2id hash of an arbitrary password (generated offline with the same
// options as `ARGON2_OPTIONS`, not derived from any real credential). `login()` always runs
// an argon2 verification, against this constant hash when the username doesn't exist, so the
// response time is comparable whether or not the account is real (mitigates username
// enumeration via timing analysis).
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$1XWyNAvsxjcb51B3O+abNw$yi+xLu3Lnfgn0vt5LIik38Yp/qgPvyAuuCKW7I1i62E';

// D13-bis: the branch of `forgotPassword` that does NOT issue a token has no secret to hash,
// unlike `issueResetToken`'s real `hashPassword(secret)` call — so it hashes this fixed,
// arbitrary string instead, purely to burn a comparable amount of argon2id work. Same idea as
// `DUMMY_PASSWORD_HASH` above, mirrored for the opposite primitive: `login()` always VERIFIES
// against a hash (real or dummy), `forgotPassword` always CREATES a hash (of a real secret, or
// of this decoy) — because the cost that needs equalizing here is a hash creation, not a
// verification. Never decoded, never compared to anything; its only job is to cost CPU time.
const DUMMY_RESET_SECRET = 'd13-bis-timing-decoy-not-a-real-reset-token-secret';

// `JwtSignOptions.expiresIn` (re-exported by `@nestjs/jwt`, inherited from `jsonwebtoken`'s
// `SignOptions`) is typed against the `ms` package's `StringValue` template-literal union
// rather than a plain `string`. `jwtConfig` only guarantees a validated `string`
// (`JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` are checked once at startup by env
// validation), so this narrowing cast is a deliberate, safe interop shim.
function toExpiresIn(value: string): JwtSignOptions['expiresIn'] {
  return value as unknown as JwtSignOptions['expiresIn'];
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokenRepository: Repository<PasswordResetToken>,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailQueueService: MailQueueService,
    @Inject(jwtConfig.KEY) private readonly config: JwtConfig,
    @Inject(appConfig.KEY) private readonly appConfiguration: AppConfig,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const alreadyExists = await this.usersService.existsByUsernameOrEmail(
      dto.username,
      dto.email,
    );
    // Deliberately non-specific: does not reveal whether it was the username or the email
    // that collided, to avoid account enumeration.
    if (alreadyExists) {
      throw new ConflictException('Username or email already in use');
    }

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    const user = await this.usersService.create({
      username: dto.username,
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
    });

    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersService.findByIdentifierWithPassword(
      dto.identifier,
    );

    const passwordMatches = await verifyPassword(
      user?.password ?? DUMMY_PASSWORD_HASH,
      dto.password,
    );

    // Exact same message for all three failure modes (unknown identifier, wrong password,
    // disabled account): revealing which one occurred would let an attacker enumerate
    // usernames/emails or detect deactivated accounts.
    if (!user || !passwordMatches || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.buildAuthResponse(user);
  }

  async refresh(dto: RefreshTokenDto): Promise<AuthResponseDto> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        dto.refreshToken,
        { secret: this.config.refreshSecret },
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenRow = await this.refreshTokenRepository.findOneBy({
      id: payload.jti,
    });
    if (!tokenRow) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (tokenRow.revokedAt) {
      // Reuse of an already-rotated refresh token indicates possible theft: revoke the
      // whole token family for this user instead of just rejecting this one request.
      await this.revokeAllActiveTokensForUser(tokenRow.userId);
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (tokenRow.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenMatches = await verifyPassword(
      tokenRow.tokenHash,
      dto.refreshToken,
    );
    if (!tokenMatches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findById(tokenRow.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    tokenRow.revokedAt = new Date();
    await this.refreshTokenRepository.save(tokenRow);

    return this.buildAuthResponse(user);
  }

  async logout(userId: string, dto: RefreshTokenDto): Promise<void> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        dto.refreshToken,
        { secret: this.config.refreshSecret },
      );
    } catch {
      // Idempotent: an invalid, expired or garbage refresh token is treated as
      // "already logged out" rather than an error.
      return;
    }

    const tokenRow = await this.refreshTokenRepository.findOneBy({
      id: payload.jti,
      userId,
    });

    if (!tokenRow || tokenRow.revokedAt) {
      return;
    }

    tokenRow.revokedAt = new Date();
    await this.refreshTokenRepository.save(tokenRow);
  }

  async me(userId: string): Promise<UserResponseDto> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return UserResponseDto.fromEntity(user);
  }

  // `PATCH /auth/me` — every authenticated user's own profile edit. `UpdateMeDto` deliberately
  // excludes `role`/`isActive` at the type level, so unlike `UsersAdminService.update` there is
  // no D3-style guard to write here: the caller can never submit them in the first place.
  async updateMe(userId: string, dto: UpdateMeDto): Promise<UserResponseDto> {
    const hasAnyField =
      dto.username !== undefined ||
      dto.email !== undefined ||
      dto.firstName !== undefined ||
      dto.lastName !== undefined ||
      dto.phone !== undefined;
    if (!hasAnyField) {
      throw new BadRequestException(
        'At least one field must be provided to update your profile',
      );
    }

    let updated: User;
    try {
      updated = await this.usersService.update(userId, {
        username: dto.username,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
      });
    } catch (error) {
      // `UsersService.update`'s own `assertNoConflict` pre-check already covers the common
      // case; this is the same TOCTOU defense-in-depth as `UsersAdminService.update` /
      // `UsersAdminService.create` for the race between that check and the final `save()`.
      if (isUniqueViolation(error)) {
        throw new ConflictException('Username or email already in use');
      }
      throw error;
    }

    return UserResponseDto.fromEntity(updated);
  }

  // D13/anti-enumeration: ALWAYS resolves to the exact same response, whether or not `dto.email`
  // belongs to an account, and whether or not that account is active. The only branching here
  // is on whether a reset email actually gets enqueued — never on what gets returned. Do not
  // add a different message/status for "email sent" vs "nothing happened": that is precisely
  // the observable difference this method exists to prevent.
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(dto.email);
    // A disabled account never receives a reset email (contract §8, "Un compte isActive = false
    // ne reçoit pas d'email et ne peut pas consommer de token") — but this check must never
    // surface in the response, only in whether `issueResetToken` runs at all.
    if (user && user.isActive) {
      await this.issueResetToken(user);
    } else {
      // D13-bis: same body, same status, same headers is not enough — a measurable timing gap
      // between "issued a token" and "didn't" is itself an account-existence oracle. Paying for
      // one argon2id hash here (discarded immediately) keeps this branch's cost in the same
      // order of magnitude as `issueResetToken`'s real `hashPassword(secret)` call, exactly like
      // `login()` already does with `DUMMY_PASSWORD_HASH` for the unknown-identifier case.
      //
      // This equalizes the dominant cost, not the entire gap. The issuing branch additionally
      // runs an UPDATE, an INSERT and a queue enqueue that this one does not. Locally the hash
      // (~23ms) dwarfs those; with a remote database and Redis the remaining difference is
      // larger, and whether the hash still dominates depends on the deployment's network
      // topology. What makes the residue uninteresting is the rate limit: at 5 requests per
      // minute, pulling a few milliseconds out of network jitter needs days of sampling per
      // target. Should that limit ever be relaxed, close the channel properly instead --
      // answer 202 first and do the work in a durable background job.
      await hashPassword(DUMMY_RESET_SECRET);
    }
    return FORGOT_PASSWORD_RESPONSE;
  }

  // D12/anti-enumeration: every failure branch below throws the exact same
  // `BadRequestException(INVALID_OR_EXPIRED_TOKEN_MESSAGE)`, regardless of which of the six
  // documented failure modes it is (malformed token, unknown row, wrong secret, already used,
  // expired, disabled account). Resist ever giving one branch a more specific message: that is
  // exactly the class of "helpful" change the contract calls out as the thing to avoid.
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const parsed = this.parseResetToken(dto.token);
    if (!parsed) {
      throw new BadRequestException(INVALID_OR_EXPIRED_TOKEN_MESSAGE);
    }

    const row = await this.passwordResetTokenRepository.findOneBy({
      id: parsed.id,
    });
    if (!row) {
      throw new BadRequestException(INVALID_OR_EXPIRED_TOKEN_MESSAGE);
    }

    const secretMatches = await verifyPassword(row.tokenHash, parsed.secret);
    if (!secretMatches) {
      throw new BadRequestException(INVALID_OR_EXPIRED_TOKEN_MESSAGE);
    }

    if (row.usedAt || row.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(INVALID_OR_EXPIRED_TOKEN_MESSAGE);
    }

    const user = await this.usersService.findById(row.userId);
    if (!user || !user.isActive) {
      throw new BadRequestException(INVALID_OR_EXPIRED_TOKEN_MESSAGE);
    }

    const passwordHash = await hashPassword(dto.newPassword);

    // D14: password + usedAt + refresh-token revocation, all in ONE transaction. A mid-way
    // failure must roll back everything, never leave the token consumed with the password
    // unchanged (or vice versa), and never leave a stale session alive after a successful reset.
    await this.passwordResetTokenRepository.manager.transaction(
      async (manager) => {
        await manager.update(User, user.id, { password: passwordHash });
        await manager.update(PasswordResetToken, row.id, {
          usedAt: new Date(),
        });
        await this.revokeAllActiveTokensForUser(user.id, manager);
      },
    );
  }

  // Rule 5/D14: emitting a fresh reset token invalidates every not-yet-used token this user
  // already had outstanding, so only one reset token is ever live at a time. Marks `usedAt`
  // rather than deleting the rows, consistent with the entity's single-use-by-timestamp design.
  private async issueResetToken(user: User): Promise<void> {
    await this.passwordResetTokenRepository.update(
      { userId: user.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    // D11: reproduces the exact same split as `issueTokenPair`'s refresh token — an argon2 hash
    // is not queryable, so only the secret is hashed into `tokenHash`; the emitted value is
    // `<row id>.<secret>` so `resetPassword` can look the row up by `id` first, then verify the
    // secret against its hash.
    const secret = randomBytes(32).toString('base64url');
    const tokenHash = await hashPassword(secret);
    const row = await this.passwordResetTokenRepository.save(
      this.passwordResetTokenRepository.create({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
        usedAt: null,
      }),
    );
    const token = `${row.id}.${secret}`;

    const resetUrl = `${this.appConfiguration.frontendUrl}/reset-password?token=${token}`;
    const rendered = passwordResetMail({
      username: user.username,
      resetUrl,
      expiresInMinutes: PASSWORD_RESET_TOKEN_TTL_MINUTES,
    });
    // D4/§8: enqueued, never sent synchronously on this call stack.
    await this.mailQueueService.enqueue({ to: user.email, ...rendered });
  }

  // Splits `<row id>.<secret>` on its FIRST '.' (base64url's alphabet never contains '.', and
  // neither does a UUID, so this cannot mis-split a well-formed token). Returns `null` for
  // anything that isn't shaped like a real token, INCLUDING an `id` that isn't a valid UUID —
  // passing a non-UUID straight to `findOneBy({ id })` would make Postgres throw a driver error
  // instead of the uniform 400 that D12 requires for a malformed token.
  private parseResetToken(
    token: string,
  ): { id: string; secret: string } | null {
    const separatorIndex = token.indexOf('.');
    if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
      return null;
    }
    const id = token.slice(0, separatorIndex);
    const secret = token.slice(separatorIndex + 1);
    if (!isUUID(id)) {
      return null;
    }
    return { id, secret };
  }

  private async buildAuthResponse(user: User): Promise<AuthResponseDto> {
    const { accessToken, refreshToken } = await this.issueTokenPair(user);

    const response = new AuthResponseDto();
    response.accessToken = accessToken;
    response.refreshToken = refreshToken;
    response.user = UserResponseDto.fromEntity(user);
    return response;
  }

  private async issueTokenPair(
    user: User,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessPayload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };
    const accessToken = this.jwtService.sign(accessPayload, {
      secret: this.config.accessSecret,
      expiresIn: toExpiresIn(this.config.accessExpiresIn),
    });

    // Insert the refresh_tokens row first, with an opaque placeholder hash that is
    // immediately overwritten below, purely to obtain its generated id, which becomes the
    // `jti` embedded in the refresh JWT. This guarantees `jti` always points at the row
    // backing the token being issued, and that the row's final `tokenHash` is the hash of
    // that exact token.
    const tokenRow = await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        userId: user.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(),
      }),
    );

    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      jti: tokenRow.id,
    };
    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.config.refreshSecret,
      expiresIn: toExpiresIn(this.config.refreshExpiresIn),
    });

    // `exp` on the freshly signed JWT is the single source of truth for `expiresAt`,
    // rather than re-parsing the `refreshExpiresIn` duration string ourselves.
    const decoded = this.jwtService.decode<{ exp?: number }>(refreshToken);
    if (typeof decoded.exp !== 'number') {
      throw new Error('Failed to decode freshly issued refresh token');
    }

    tokenRow.tokenHash = await argon2.hash(refreshToken, ARGON2_OPTIONS);
    tokenRow.expiresAt = new Date(decoded.exp * 1000);
    await this.refreshTokenRepository.save(tokenRow);

    return { accessToken, refreshToken };
  }

  // Optionally accepts an `EntityManager` (T6.5/D14) so `resetPassword` can run this update
  // inside its own `manager.transaction(...)`, alongside the password change and the token's
  // `usedAt`, instead of as a separate, independently-committed write. `refresh()`'s existing
  // call site (token-family revocation on replay detection) is unaffected: it still passes no
  // manager and goes straight through `refreshTokenRepository` exactly as before.
  private async revokeAllActiveTokensForUser(
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repository = manager
      ? manager.getRepository(RefreshToken)
      : this.refreshTokenRepository;
    await repository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }
}
