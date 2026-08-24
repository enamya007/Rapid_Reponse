import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions, JwtVerifyOptions } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
// `import * as argon2 from 'argon2'` is wrapped by TypeScript's CommonJS/ESM interop helper
// (`esModuleInterop`) into a fresh namespace object with non-configurable getter-backed
// properties, which `jest.spyOn` cannot redefine ("Cannot redefine property"). Spying instead
// on the raw, un-wrapped `require('argon2')` module object works, and is observed by
// `auth.service.ts`'s own `argon2` reference too, since its interop-wrapped getters read
// straight through to this same underlying (Node-module-cache-shared) object.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import argon2Raw = require('argon2');
import { EntityManager, FindOptionsWhere, IsNull, UpdateResult } from 'typeorm';
import { verifyPassword } from '../../common/security/password.util';
import { AppConfig, appConfig } from '../../config/app.config';
import { Environment } from '../../config/env.validation';
import { JwtConfig, jwtConfig } from '../../config/jwt.config';
import { MailMessage } from '../mail/dto/mail-message';
import { MailQueueService } from '../mail/mail-queue.service';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateUserData } from '../users/types/create-user-data.type';
import { UpdateUserData, UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { JwtPayload, RefreshTokenPayload } from './types/jwt-payload.type';

// Cheap-to-compute argon2id parameters, only used to build realistic-looking test fixtures
// (e.g. "the hash currently stored for a user") quickly. `argon2.verify()` reads the cost
// parameters back out of the encoded hash itself, so these do not need to match
// `AuthService`'s own (deliberately expensive) `ARGON2_OPTIONS`.
const FAST_ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 8,
  timeCost: 1,
  parallelism: 1,
};

const MOCK_JWT_CONFIG: JwtConfig = {
  accessSecret: 'unit-test-access-secret',
  accessExpiresIn: '15m',
  refreshSecret: 'unit-test-refresh-secret',
  refreshExpiresIn: '7d',
};

const MOCK_APP_CONFIG: AppConfig = {
  nodeEnv: Environment.Test,
  port: 3000,
  corsOrigins: 'http://localhost:3000',
  swaggerEnabled: false,
  swaggerPath: 'docs',
  frontendUrl: 'https://app.example.com',
};

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.username = 'jdoe';
  user.email = 'jdoe@example.com';
  user.password = 'unused-in-this-test';
  user.role = UserRole.CLIENT;
  user.isActive = true;
  user.createdAt = new Date('2024-01-01T00:00:00.000Z');
  user.updatedAt = new Date('2024-01-01T00:00:00.000Z');
  Object.assign(user, overrides);
  return user;
}

function buildRefreshTokenRow(
  overrides: Partial<RefreshToken> = {},
): RefreshToken {
  const row = new RefreshToken();
  row.id = 'row-id';
  row.userId = 'user-1';
  row.tokenHash = 'placeholder-hash';
  row.expiresAt = new Date(Date.now() + 60_000);
  row.revokedAt = null;
  row.createdAt = new Date();
  Object.assign(row, overrides);
  return row;
}

function buildUpdateResult(): UpdateResult {
  return { raw: [], affected: 1, generatedMaps: [] };
}

function buildPasswordResetTokenRow(
  overrides: Partial<PasswordResetToken> = {},
): PasswordResetToken {
  const row = new PasswordResetToken();
  row.id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  row.userId = 'user-1';
  row.tokenHash = 'placeholder-hash';
  row.expiresAt = new Date(Date.now() + 3_600_000);
  row.usedAt = null;
  row.createdAt = new Date();
  Object.assign(row, overrides);
  return row;
}

// Mock stand-in for the `EntityManager` handed to `resetPassword`'s
// `passwordResetTokenRepository.manager.transaction(...)` callback (same pattern as
// `tickets.service.spec.ts`'s own `MockTransactionEntityManager`). `update` is exercised
// directly for the `User`/`PasswordResetToken` writes; `getRepository` stands in for the branch
// `revokeAllActiveTokensForUser` takes when it IS given a manager (T6.5/D14).
interface MockTransactionEntityManager {
  update: jest.Mock<
    Promise<UpdateResult>,
    [unknown, string, Record<string, unknown>]
  >;
  getRepository: jest.Mock<
    { update: jest.Mock<Promise<UpdateResult>, [unknown, unknown]> },
    [unknown]
  >;
}

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    existsByUsernameOrEmail: jest.Mock<Promise<boolean>, [string, string]>;
    create: jest.Mock<Promise<User>, [CreateUserData]>;
    findByIdentifierWithPassword: jest.Mock<Promise<User | null>, [string]>;
    findById: jest.Mock<Promise<User | null>, [string]>;
    findByUsername: jest.Mock<Promise<User | null>, [string]>;
    findByEmail: jest.Mock<Promise<User | null>, [string]>;
    update: jest.Mock<Promise<User>, [string, UpdateUserData]>;
  };
  let jwtService: {
    sign: jest.Mock<
      string,
      [JwtPayload | RefreshTokenPayload, JwtSignOptions?]
    >;
    verifyAsync: jest.Mock<
      Promise<RefreshTokenPayload>,
      [string, JwtVerifyOptions?]
    >;
    decode: jest.Mock<{ exp?: number } | null, [string]>;
  };
  let refreshTokenRepository: {
    create: jest.Mock<RefreshToken, [Partial<RefreshToken>]>;
    save: jest.Mock<Promise<RefreshToken>, [RefreshToken]>;
    findOneBy: jest.Mock<
      Promise<RefreshToken | null>,
      [FindOptionsWhere<RefreshToken>]
    >;
    update: jest.Mock<
      Promise<UpdateResult>,
      [FindOptionsWhere<RefreshToken>, Partial<RefreshToken>]
    >;
  };
  let passwordResetTokenRepository: {
    create: jest.Mock<PasswordResetToken, [Partial<PasswordResetToken>]>;
    save: jest.Mock<Promise<PasswordResetToken>, [PasswordResetToken]>;
    findOneBy: jest.Mock<
      Promise<PasswordResetToken | null>,
      [FindOptionsWhere<PasswordResetToken>]
    >;
    update: jest.Mock<
      Promise<UpdateResult>,
      [FindOptionsWhere<PasswordResetToken>, Partial<PasswordResetToken>]
    >;
    manager: { transaction: jest.Mock };
  };
  let mailQueueService: {
    enqueue: jest.Mock<Promise<void>, [MailMessage]>;
  };
  let transactionEntityManager: MockTransactionEntityManager;
  // The repository `revokeAllActiveTokensForUser` obtains via
  // `manager.getRepository(RefreshToken)` when it runs inside `resetPassword`'s transaction —
  // deliberately a SEPARATE mock from `refreshTokenRepository` above (which is what the
  // no-manager call sites, e.g. `refresh()`'s replay detection, still use), so tests can tell
  // the two call paths apart.
  let refreshTokenRepositoryViaManager: {
    update: jest.Mock<Promise<UpdateResult>, [unknown, unknown]>;
  };

  // Default "happy path" wiring for `issueTokenPair()`, reused by every test that reaches
  // `buildAuthResponse()` (register / login / refresh). Individual tests only override what
  // they specifically care about.
  function wireDefaultTokenIssuance(): void {
    let rowCounter = 0;
    refreshTokenRepository.create.mockImplementation(
      (data: Partial<RefreshToken>) => {
        rowCounter += 1;
        return buildRefreshTokenRow({
          ...data,
          id: `generated-row-${rowCounter}`,
        });
      },
    );
    refreshTokenRepository.save.mockImplementation((row: RefreshToken) =>
      Promise.resolve(row),
    );
    jwtService.sign.mockImplementation(
      (payload: { sub: string; jti?: string }) =>
        'jti' in payload
          ? `mock-refresh-token-for-${payload.jti}`
          : `mock-access-token-for-${payload.sub}`,
    );
    jwtService.decode.mockReturnValue({
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
  }

  beforeEach(async () => {
    usersService = {
      existsByUsernameOrEmail: jest.fn<Promise<boolean>, [string, string]>(),
      create: jest.fn<Promise<User>, [CreateUserData]>(),
      findByIdentifierWithPassword: jest.fn<Promise<User | null>, [string]>(),
      findById: jest.fn<Promise<User | null>, [string]>(),
      findByUsername: jest.fn<Promise<User | null>, [string]>(),
      findByEmail: jest.fn<Promise<User | null>, [string]>(),
      update: jest.fn<Promise<User>, [string, UpdateUserData]>(),
    };
    jwtService = {
      sign: jest.fn<
        string,
        [JwtPayload | RefreshTokenPayload, JwtSignOptions?]
      >(),
      verifyAsync: jest.fn<
        Promise<RefreshTokenPayload>,
        [string, JwtVerifyOptions?]
      >(),
      decode: jest.fn<{ exp?: number } | null, [string]>(),
    };
    refreshTokenRepository = {
      create: jest.fn<RefreshToken, [Partial<RefreshToken>]>(),
      save: jest.fn<Promise<RefreshToken>, [RefreshToken]>(),
      findOneBy: jest.fn<
        Promise<RefreshToken | null>,
        [FindOptionsWhere<RefreshToken>]
      >(),
      update: jest
        .fn<
          Promise<UpdateResult>,
          [FindOptionsWhere<RefreshToken>, Partial<RefreshToken>]
        >()
        .mockResolvedValue(buildUpdateResult()),
    };
    refreshTokenRepositoryViaManager = {
      update: jest
        .fn<Promise<UpdateResult>, [unknown, unknown]>()
        .mockResolvedValue(buildUpdateResult()),
    };
    transactionEntityManager = {
      update: jest
        .fn<Promise<UpdateResult>, [unknown, string, Record<string, unknown>]>()
        .mockResolvedValue(buildUpdateResult()),
      getRepository: jest
        .fn<
          { update: jest.Mock<Promise<UpdateResult>, [unknown, unknown]> },
          [unknown]
        >()
        .mockReturnValue(refreshTokenRepositoryViaManager),
    };
    // Runs the given callback with the mock `EntityManager` above, exactly like TypeORM's real
    // `EntityManager.transaction` does (same pattern as `tickets.service.spec.ts`).
    const transactionMock = jest
      .fn<Promise<void>, [(em: EntityManager) => Promise<void>]>()
      .mockImplementation((callback) =>
        callback(transactionEntityManager as unknown as EntityManager),
      );
    let resetTokenRowCounter = 0;
    passwordResetTokenRepository = {
      create: jest.fn<PasswordResetToken, [Partial<PasswordResetToken>]>(
        (data: Partial<PasswordResetToken>) => {
          resetTokenRowCounter += 1;
          return buildPasswordResetTokenRow({
            ...data,
            id: `00000000-0000-4000-8000-${String(resetTokenRowCounter).padStart(12, '0')}`,
          });
        },
      ),
      save: jest.fn<Promise<PasswordResetToken>, [PasswordResetToken]>(
        (row: PasswordResetToken) => Promise.resolve(row),
      ),
      findOneBy: jest.fn<
        Promise<PasswordResetToken | null>,
        [FindOptionsWhere<PasswordResetToken>]
      >(),
      update: jest
        .fn<
          Promise<UpdateResult>,
          [FindOptionsWhere<PasswordResetToken>, Partial<PasswordResetToken>]
        >()
        .mockResolvedValue(buildUpdateResult()),
      manager: { transaction: transactionMock },
    };
    mailQueueService = {
      enqueue: jest
        .fn<Promise<void>, [MailMessage]>()
        .mockResolvedValue(undefined),
    };
    wireDefaultTokenIssuance();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: refreshTokenRepository,
        },
        {
          provide: getRepositoryToken(PasswordResetToken),
          useValue: passwordResetTokenRepository,
        },
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: MailQueueService, useValue: mailQueueService },
        { provide: jwtConfig.KEY, useValue: MOCK_JWT_CONFIG },
        { provide: appConfig.KEY, useValue: MOCK_APP_CONFIG },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('register', () => {
    const registerDto: RegisterDto = {
      username: 'newuser',
      email: 'newuser@example.com',
      password: 'Str0ngP@ssw0rd',
    };

    it('rejects registration when the username or email is already taken, without creating a user', async () => {
      usersService.existsByUsernameOrEmail.mockResolvedValue(true);

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('hashes the password before persisting the user (never stores it in clear text)', async () => {
      usersService.existsByUsernameOrEmail.mockResolvedValue(false);
      usersService.create.mockResolvedValue(buildUser());

      await service.register(registerDto);

      expect(usersService.create).toHaveBeenCalledTimes(1);
      const [createArg] = usersService.create.mock.calls[0];
      expect(createArg.passwordHash).not.toBe(registerDto.password);
      expect(createArg.passwordHash).toMatch(/^\$argon2id\$/);
    });
  });

  describe('login', () => {
    const correctPassword = 'CorrectPassw0rd123';
    let hashedPassword: string;

    beforeAll(async () => {
      hashedPassword = await argon2.hash(correctPassword, FAST_ARGON2_OPTIONS);
    });

    it('logs in when the identifier is the username', async () => {
      const user = buildUser({ password: hashedPassword });
      usersService.findByIdentifierWithPassword.mockResolvedValue(user);

      const result = await service.login({
        identifier: user.username,
        password: correctPassword,
      });

      expect(usersService.findByIdentifierWithPassword).toHaveBeenCalledWith(
        user.username,
      );
      expect(result.user.username).toBe(user.username);
    });

    it('logs in when the identifier is the email', async () => {
      const user = buildUser({ password: hashedPassword });
      usersService.findByIdentifierWithPassword.mockResolvedValue(user);

      const result = await service.login({
        identifier: user.email,
        password: correctPassword,
      });

      expect(usersService.findByIdentifierWithPassword).toHaveBeenCalledWith(
        user.email,
      );
      expect(result.user.email).toBe(user.email);
    });

    it('rejects an unknown identifier', async () => {
      usersService.findByIdentifierWithPassword.mockResolvedValue(null);

      await expect(
        service.login({ identifier: 'ghost', password: 'whatever' }),
      ).rejects.toThrow('Invalid credentials');
    });

    it('rejects a wrong password with the exact same message as an unknown identifier (anti-enumeration)', async () => {
      const user = buildUser({ password: hashedPassword });
      usersService.findByIdentifierWithPassword.mockResolvedValue(user);

      await expect(
        service.login({
          identifier: user.username,
          password: 'WrongPassword1',
        }),
      ).rejects.toThrow('Invalid credentials');
    });

    it('rejects a disabled account with the exact same message as an unknown identifier (anti-enumeration)', async () => {
      const user = buildUser({ password: hashedPassword, isActive: false });
      usersService.findByIdentifierWithPassword.mockResolvedValue(user);

      await expect(
        service.login({
          identifier: user.username,
          password: correctPassword,
        }),
      ).rejects.toThrow('Invalid credentials');
    });

    it('still runs an argon2 verification for an unknown identifier (timing-attack mitigation)', async () => {
      usersService.findByIdentifierWithPassword.mockResolvedValue(null);
      const verifySpy = jest.spyOn(argon2Raw, 'verify');

      await expect(
        service.login({ identifier: 'ghost', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(verifySpy).toHaveBeenCalledTimes(1);
      const [hashArg] = verifySpy.mock.calls[0] as [string, string];
      // The dummy hash used when the account doesn't exist is a real, well-formed argon2id
      // hash, not a short-circuited constant: `argon2.verify` genuinely does the work.
      expect(hashArg).toMatch(/^\$argon2id\$/);
    });

    it('rejects with a plain 401 (not a 500) when the stored password hash is malformed/corrupt', async () => {
      const user = buildUser({ password: 'not-a-valid-argon2-hash' });
      usersService.findByIdentifierWithPassword.mockResolvedValue(user);

      await expect(
        service.login({
          identifier: user.username,
          password: correctPassword,
        }),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    });
  });

  describe('refresh', () => {
    it('rejects when the refresh JWT fails verification', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));

      await expect(
        service.refresh({ refreshToken: 'garbage' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid refresh token'));
      expect(refreshTokenRepository.findOneBy).not.toHaveBeenCalled();
    });

    it('revokes the whole token family when an already-revoked refresh token is reused', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', jti: 'row-1' });
      refreshTokenRepository.findOneBy.mockResolvedValue(
        buildRefreshTokenRow({ id: 'row-1', revokedAt: new Date() }),
      );

      await expect(
        service.refresh({ refreshToken: 'stale-token' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid refresh token'));

      expect(refreshTokenRepository.update).toHaveBeenCalledTimes(1);
      const [where, patch] = refreshTokenRepository.update.mock.calls[0] as [
        { userId: string },
        { revokedAt: Date },
      ];
      expect(where.userId).toBe('user-1');
      expect(patch.revokedAt).toBeInstanceOf(Date);
    });

    it('rejects an expired refresh token row', async () => {
      // Every other check is deliberately made to pass (matching hash, active user), so that
      // only the expiry check can be responsible for the rejection: if it were skipped, this
      // refresh would otherwise succeed and return a fresh token pair.
      const rawRefreshToken = 'expired-token';
      const tokenHash = await argon2.hash(rawRefreshToken, FAST_ARGON2_OPTIONS);
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', jti: 'row-2' });
      refreshTokenRepository.findOneBy.mockResolvedValue(
        buildRefreshTokenRow({
          id: 'row-2',
          tokenHash,
          expiresAt: new Date(Date.now() - 1_000),
        }),
      );
      usersService.findById.mockResolvedValue(buildUser());

      await expect(
        service.refresh({ refreshToken: rawRefreshToken }),
      ).rejects.toThrow(new UnauthorizedException('Invalid refresh token'));
    });

    it('rejects when the refresh token does not match the stored hash, even though the jti is valid', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', jti: 'row-3' });
      const unrelatedHash = await argon2.hash(
        'some-other-token',
        FAST_ARGON2_OPTIONS,
      );
      refreshTokenRepository.findOneBy.mockResolvedValue(
        buildRefreshTokenRow({ id: 'row-3', tokenHash: unrelatedHash }),
      );

      await expect(
        service.refresh({ refreshToken: 'mismatched-token' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid refresh token'));
    });

    it('rejects with a plain "Invalid refresh token" (not a leaked exception) when the stored token hash is malformed/corrupt', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', jti: 'row-5' });
      refreshTokenRepository.findOneBy.mockResolvedValue(
        buildRefreshTokenRow({
          id: 'row-5',
          tokenHash: 'not-a-valid-argon2-hash',
        }),
      );

      await expect(
        service.refresh({ refreshToken: 'whatever-token' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid refresh token'));
    });

    it('rotates the refresh token on a valid refresh: revokes the old row and issues a fresh pair', async () => {
      const rawRefreshToken = 'valid-refresh-token';
      const tokenHash = await argon2.hash(rawRefreshToken, FAST_ARGON2_OPTIONS);
      const existingRow = buildRefreshTokenRow({
        id: 'row-4',
        tokenHash,
      });
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', jti: 'row-4' });
      refreshTokenRepository.findOneBy.mockResolvedValue(existingRow);
      usersService.findById.mockResolvedValue(buildUser());

      const result = await service.refresh({ refreshToken: rawRefreshToken });

      expect(existingRow.revokedAt).not.toBeNull();
      const revocationSaveCall = refreshTokenRepository.save.mock.calls.find(
        ([row]) => row.id === 'row-4',
      );
      expect(revocationSaveCall).toBeDefined();
      expect(revocationSaveCall?.[0].revokedAt).toBeInstanceOf(Date);
      expect(result.refreshToken).not.toBe(rawRefreshToken);
      expect(result.accessToken).toBeTruthy();
    });
  });

  describe('logout', () => {
    it('is idempotent: an unknown or already-revoked refresh token raises no exception', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        jti: 'missing-row',
      });
      refreshTokenRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.logout('user-1', { refreshToken: 'whatever' }),
      ).resolves.toBeUndefined();
      expect(refreshTokenRepository.save).not.toHaveBeenCalled();
    });

    it('is also idempotent for an invalid/garbage refresh token (fails verification)', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('bad token'));

      await expect(
        service.logout('user-1', { refreshToken: 'garbage' }),
      ).resolves.toBeUndefined();
      expect(refreshTokenRepository.findOneBy).not.toHaveBeenCalled();
    });

    it("scopes the lookup to the calling user, so it cannot revoke another user's token", async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'attacker-id',
        jti: 'victim-row',
      });
      // The victim's row exists, but is owned by a different user: a lookup correctly scoped
      // by `userId` must not find it.
      refreshTokenRepository.findOneBy.mockResolvedValue(null);

      await service.logout('attacker-id', { refreshToken: 'victims-token' });

      expect(refreshTokenRepository.findOneBy).toHaveBeenCalledWith({
        id: 'victim-row',
        userId: 'attacker-id',
      });
      expect(refreshTokenRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('token storage', () => {
    it('never persists the raw refresh token: the stored tokenHash is an argon2id hash, distinct from the issued JWT', async () => {
      usersService.existsByUsernameOrEmail.mockResolvedValue(false);
      usersService.create.mockResolvedValue(buildUser());

      const response = await service.register({
        username: 'newuser2',
        email: 'newuser2@example.com',
        password: 'Str0ngP@ssw0rd',
      });

      const savedRows = refreshTokenRepository.save.mock.calls.map(
        ([row]) => row,
      );
      const finalRow = savedRows[savedRows.length - 1];
      expect(finalRow.tokenHash).toMatch(/^\$argon2id\$/);
      expect(finalRow.tokenHash).not.toBe(response.refreshToken);
    });
  });

  describe('forgotPassword', () => {
    const dto: ForgotPasswordDto = { email: 'jdoe@example.com' };
    const RESPONSE_MESSAGE = {
      message: 'If the account exists, a reset link has been sent.',
    };

    it('returns the fixed anti-enumeration body when the account exists and is active', async () => {
      usersService.findByEmail.mockResolvedValue(
        buildUser({ email: dto.email }),
      );

      await expect(service.forgotPassword(dto)).resolves.toEqual(
        RESPONSE_MESSAGE,
      );
    });

    // D13: the whole point of this endpoint is that these three bodies are indistinguishable.
    it('D13: returns the EXACT SAME body for an existing account, an unknown email, and a disabled account (anti-enumeration)', async () => {
      usersService.findByEmail.mockResolvedValueOnce(
        buildUser({ email: dto.email }),
      );
      const existingAccountBody = await service.forgotPassword(dto);

      usersService.findByEmail.mockResolvedValueOnce(null);
      const unknownAccountBody = await service.forgotPassword(dto);

      usersService.findByEmail.mockResolvedValueOnce(
        buildUser({ email: dto.email, isActive: false }),
      );
      const disabledAccountBody = await service.forgotPassword(dto);

      expect(existingAccountBody).toEqual(RESPONSE_MESSAGE);
      expect(unknownAccountBody).toEqual(existingAccountBody);
      expect(disabledAccountBody).toEqual(existingAccountBody);
    });

    it('does not issue a token nor enqueue an email when the account does not exist', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await service.forgotPassword(dto);

      expect(passwordResetTokenRepository.save).not.toHaveBeenCalled();
      expect(mailQueueService.enqueue).not.toHaveBeenCalled();
    });

    it('does not issue a token nor enqueue an email for a disabled account (contract §8)', async () => {
      usersService.findByEmail.mockResolvedValue(
        buildUser({ email: dto.email, isActive: false }),
      );

      await service.forgotPassword(dto);

      expect(passwordResetTokenRepository.save).not.toHaveBeenCalled();
      expect(mailQueueService.enqueue).not.toHaveBeenCalled();
    });

    it('D11: issues a token shaped "<row id>.<secret>", persists ONLY an argon2 hash of the secret (never the secret itself), and enqueues the rendered mail via MailQueueService', async () => {
      const user = buildUser({ email: dto.email, username: 'jdoe' });
      usersService.findByEmail.mockResolvedValue(user);

      await service.forgotPassword(dto);

      expect(passwordResetTokenRepository.save).toHaveBeenCalledTimes(1);
      const savedRow = passwordResetTokenRepository.save.mock.calls[0][0];
      expect(savedRow.userId).toBe(user.id);
      expect(savedRow.tokenHash).toMatch(/^\$argon2id\$/);

      expect(mailQueueService.enqueue).toHaveBeenCalledTimes(1);
      const [message] = mailQueueService.enqueue.mock.calls[0];
      expect(message.to).toBe(user.email);

      const tokenMatch = message.text.match(/token=(\S+)/);
      expect(tokenMatch).not.toBeNull();
      const token = tokenMatch![1];
      const separatorIndex = token.indexOf('.');
      const id = token.slice(0, separatorIndex);
      const secret = token.slice(separatorIndex + 1);

      expect(id).toBe(savedRow.id);
      // The secret itself is never what got persisted...
      expect(savedRow.tokenHash).not.toBe(secret);
      // ...but it IS what the persisted hash verifies against.
      await expect(verifyPassword(savedRow.tokenHash, secret)).resolves.toBe(
        true,
      );
    });

    it('marks EVERY not-yet-used token for this user as used BEFORE issuing the new one (rule: only one live reset token at a time)', async () => {
      const user = buildUser({ email: dto.email });
      usersService.findByEmail.mockResolvedValue(user);

      await service.forgotPassword(dto);

      expect(passwordResetTokenRepository.update).toHaveBeenCalledTimes(1);
      const [where, patch] = passwordResetTokenRepository.update.mock
        .calls[0] as [{ userId: string }, { usedAt: Date }];
      expect(where).toEqual({ userId: user.id, usedAt: IsNull() });
      expect(patch.usedAt).toBeInstanceOf(Date);

      const updateOrder =
        passwordResetTokenRepository.update.mock.invocationCallOrder[0];
      const saveOrder =
        passwordResetTokenRepository.save.mock.invocationCallOrder[0];
      expect(updateOrder).toBeLessThan(saveOrder);
    });

    it('sets expiresAt to EXACTLY now + 1 hour (P6 contract §8 TTL), verified with a controllable clock', async () => {
      jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') });
      try {
        usersService.findByEmail.mockResolvedValue(
          buildUser({ email: dto.email }),
        );

        await service.forgotPassword(dto);

        const savedRow = passwordResetTokenRepository.save.mock.calls[0][0];
        expect(savedRow.expiresAt.toISOString()).toBe(
          '2026-01-01T01:00:00.000Z',
        );
      } finally {
        jest.useRealTimers();
      }
    });

    // D13-bis: same body/status/headers is not enough on its own -- a measurable timing gap
    // between "issued a token" and "didn't" is itself an account-existence oracle. These assert
    // on the PRIMITIVE actually being invoked (`argon2.hash`, spied the same way the existing
    // `login()` timing-mitigation test spies on `argon2.verify` above), never on a measured
    // duration: a stopwatch-based assertion would be flaky in CI and would not reliably prove
    // anything about relative cost.
    describe('D13-bis: timing side channel', () => {
      it('hashes a decoy secret (same argon2id cost as the real one) when the email does not exist', async () => {
        usersService.findByEmail.mockResolvedValue(null);
        const hashSpy = jest.spyOn(argon2Raw, 'hash');

        await service.forgotPassword(dto);

        expect(hashSpy).toHaveBeenCalledTimes(1);
        const [, options] = hashSpy.mock.calls[0] as [
          string,
          argon2.HashOptions,
        ];
        // Same options object `hashPassword`/`ARGON2_OPTIONS` uses for the real call below --
        // this is what makes the two branches' cost actually comparable, not just "some hash".
        expect(options).toMatchObject({
          type: argon2.argon2id,
          memoryCost: 19456,
          timeCost: 2,
        });
      });

      it('hashes the same decoy secret for a disabled account (no token issued either)', async () => {
        usersService.findByEmail.mockResolvedValue(
          buildUser({ email: dto.email, isActive: false }),
        );
        const hashSpy = jest.spyOn(argon2Raw, 'hash');

        await service.forgotPassword(dto);

        expect(hashSpy).toHaveBeenCalledTimes(1);
      });

      it('pays for exactly ONE hash -- the real one -- when a token IS issued (no double cost stacking)', async () => {
        usersService.findByEmail.mockResolvedValue(
          buildUser({ email: dto.email }),
        );
        const hashSpy = jest.spyOn(argon2Raw, 'hash');

        await service.forgotPassword(dto);

        expect(hashSpy).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('resetPassword', () => {
    function buildDto(token: string): ResetPasswordDto {
      return { token, newPassword: 'NewStr0ngP@ss1' };
    }

    it('resets the password, marks the token used, and revokes every active refresh token for the user -- all inside ONE transaction (D14)', async () => {
      const secret = 'valid-secret-value';
      const tokenHash = await argon2.hash(secret, FAST_ARGON2_OPTIONS);
      const row = buildPasswordResetTokenRow({
        id: '11111111-1111-4111-8111-111111111111',
        userId: 'user-1',
        tokenHash,
      });
      passwordResetTokenRepository.findOneBy.mockResolvedValue(row);
      usersService.findById.mockResolvedValue(buildUser({ id: 'user-1' }));

      await service.resetPassword(buildDto(`${row.id}.${secret}`));

      expect(passwordResetTokenRepository.findOneBy).toHaveBeenCalledWith({
        id: row.id,
      });
      expect(
        passwordResetTokenRepository.manager.transaction,
      ).toHaveBeenCalledTimes(1);

      expect(transactionEntityManager.update).toHaveBeenCalledTimes(2);
      const [userUpdateCall, tokenUpdateCall] =
        transactionEntityManager.update.mock.calls;
      expect(userUpdateCall[0]).toBe(User);
      expect(userUpdateCall[1]).toBe('user-1');
      expect((userUpdateCall[2] as { password: string }).password).toMatch(
        /^\$argon2id\$/,
      );
      expect(tokenUpdateCall[0]).toBe(PasswordResetToken);
      expect(tokenUpdateCall[1]).toBe(row.id);
      expect((tokenUpdateCall[2] as { usedAt: Date }).usedAt).toBeInstanceOf(
        Date,
      );

      // Revocation of active refresh tokens happened through the SAME transactional manager
      // (`manager.getRepository(RefreshToken)`), never through the plain, non-transactional
      // `refreshTokenRepository` used elsewhere (e.g. `refresh()`'s replay detection).
      expect(transactionEntityManager.getRepository).toHaveBeenCalledWith(
        RefreshToken,
      );
      expect(refreshTokenRepositoryViaManager.update).toHaveBeenCalledTimes(1);
      const [where, patch] = refreshTokenRepositoryViaManager.update.mock
        .calls[0] as [{ userId: string }, { revokedAt: Date }];
      expect(where).toEqual({ userId: 'user-1', revokedAt: IsNull() });
      expect(patch.revokedAt).toBeInstanceOf(Date);
      expect(refreshTokenRepository.update).not.toHaveBeenCalled();
    });

    it('rejects a malformed token (no separator), without ever querying the database', async () => {
      await expect(
        service.resetPassword(buildDto('not-a-valid-token')),
      ).rejects.toThrow(new BadRequestException('Invalid or expired token'));
      expect(passwordResetTokenRepository.findOneBy).not.toHaveBeenCalled();
      expect(
        passwordResetTokenRepository.manager.transaction,
      ).not.toHaveBeenCalled();
    });

    it('rejects a token whose id segment is not a valid UUID, without ever querying the database', async () => {
      await expect(
        service.resetPassword(buildDto('not-a-uuid.some-secret')),
      ).rejects.toThrow(new BadRequestException('Invalid or expired token'));
      expect(passwordResetTokenRepository.findOneBy).not.toHaveBeenCalled();
    });

    it('rejects an id that does not match any row', async () => {
      passwordResetTokenRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.resetPassword(
          buildDto('11111111-1111-4111-8111-111111111111.some-secret'),
        ),
      ).rejects.toThrow(new BadRequestException('Invalid or expired token'));
    });

    it('rejects a wrong secret (hash mismatch), without ever loading the user', async () => {
      const tokenHash = await argon2.hash(
        'correct-secret',
        FAST_ARGON2_OPTIONS,
      );
      const row = buildPasswordResetTokenRow({ tokenHash });
      passwordResetTokenRepository.findOneBy.mockResolvedValue(row);

      await expect(
        service.resetPassword(buildDto(`${row.id}.wrong-secret`)),
      ).rejects.toThrow(new BadRequestException('Invalid or expired token'));
      expect(usersService.findById).not.toHaveBeenCalled();
    });

    it('rejects an already-used token, and never even reaches the user lookup (proves the usedAt check, not a downstream one, is what rejects it)', async () => {
      const secret = 'valid-secret';
      const tokenHash = await argon2.hash(secret, FAST_ARGON2_OPTIONS);
      const row = buildPasswordResetTokenRow({
        tokenHash,
        usedAt: new Date(),
      });
      passwordResetTokenRepository.findOneBy.mockResolvedValue(row);

      await expect(
        service.resetPassword(buildDto(`${row.id}.${secret}`)),
      ).rejects.toThrow(new BadRequestException('Invalid or expired token'));
      // Without this, the test would pass for the WRONG reason: `usersService.findById` is
      // never configured here, so it defaults to resolving `undefined`, which the "account
      // missing" branch further down would ALSO reject with the exact same message -- masking
      // a mutation that deletes the `usedAt` check entirely. Asserting the call never happens
      // proves the rejection came from the usedAt/expiry guard, before the user is even loaded.
      expect(usersService.findById).not.toHaveBeenCalled();
    });

    it('rejects an expired token, using a controllable clock rather than an approximate expiry, and never even reaches the user lookup', async () => {
      jest.useFakeTimers({ now: new Date('2026-01-01T02:00:00.000Z') });
      try {
        const secret = 'valid-secret';
        const tokenHash = await argon2.hash(secret, FAST_ARGON2_OPTIONS);
        const row = buildPasswordResetTokenRow({
          tokenHash,
          // Issued exactly 1h + 1s before "now": one second past its 1h TTL.
          expiresAt: new Date('2026-01-01T00:59:59.000Z'),
        });
        passwordResetTokenRepository.findOneBy.mockResolvedValue(row);

        await expect(
          service.resetPassword(buildDto(`${row.id}.${secret}`)),
        ).rejects.toThrow(new BadRequestException('Invalid or expired token'));
        // Same rationale as the "already-used" test above: proves the expiry guard itself
        // rejected the token, rather than a coincidentally-undefined `findById` mock.
        expect(usersService.findById).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('rejects when the account backing the token no longer exists', async () => {
      const secret = 'valid-secret';
      const tokenHash = await argon2.hash(secret, FAST_ARGON2_OPTIONS);
      const row = buildPasswordResetTokenRow({ tokenHash });
      passwordResetTokenRepository.findOneBy.mockResolvedValue(row);
      usersService.findById.mockResolvedValue(null);

      await expect(
        service.resetPassword(buildDto(`${row.id}.${secret}`)),
      ).rejects.toThrow(new BadRequestException('Invalid or expired token'));
    });

    it('rejects when the account is disabled', async () => {
      const secret = 'valid-secret';
      const tokenHash = await argon2.hash(secret, FAST_ARGON2_OPTIONS);
      const row = buildPasswordResetTokenRow({ tokenHash });
      passwordResetTokenRepository.findOneBy.mockResolvedValue(row);
      usersService.findById.mockResolvedValue(buildUser({ isActive: false }));

      await expect(
        service.resetPassword(buildDto(`${row.id}.${secret}`)),
      ).rejects.toThrow(new BadRequestException('Invalid or expired token'));
    });

    // D12: collects the thrown message across every one of the six documented failure modes and
    // asserts they collapse to a single value -- a stronger guarantee than checking each one in
    // isolation, since it would catch a future edit that gives just ONE branch a "helpful",
    // slightly different message.
    it('D12: every one of the six failure modes throws the exact same message', async () => {
      const messages: string[] = [];
      const captureFailure = async (
        setup: () => void,
        token: string,
      ): Promise<void> => {
        setup();
        try {
          await service.resetPassword(buildDto(token));
          throw new Error('expected resetPassword to reject, it resolved');
        } catch (error) {
          messages.push((error as BadRequestException).message);
        }
      };

      await captureFailure(() => {
        // malformed: no '.' separator at all
      }, 'malformed-token-no-separator');

      await captureFailure(() => {
        passwordResetTokenRepository.findOneBy.mockResolvedValueOnce(null);
      }, '11111111-1111-4111-8111-111111111111.unknown-row');

      const wrongSecretHash = await argon2.hash(
        'correct-secret',
        FAST_ARGON2_OPTIONS,
      );
      await captureFailure(() => {
        passwordResetTokenRepository.findOneBy.mockResolvedValueOnce(
          buildPasswordResetTokenRow({ tokenHash: wrongSecretHash }),
        );
      }, '11111111-1111-4111-8111-111111111111.wrong-secret');

      const usedSecret = 'used-secret';
      const usedHash = await argon2.hash(usedSecret, FAST_ARGON2_OPTIONS);
      await captureFailure(() => {
        passwordResetTokenRepository.findOneBy.mockResolvedValueOnce(
          buildPasswordResetTokenRow({
            tokenHash: usedHash,
            usedAt: new Date(),
          }),
        );
      }, `11111111-1111-4111-8111-111111111111.${usedSecret}`);

      const expiredSecret = 'expired-secret';
      const expiredHash = await argon2.hash(expiredSecret, FAST_ARGON2_OPTIONS);
      await captureFailure(() => {
        passwordResetTokenRepository.findOneBy.mockResolvedValueOnce(
          buildPasswordResetTokenRow({
            tokenHash: expiredHash,
            expiresAt: new Date(Date.now() - 1_000),
          }),
        );
      }, `11111111-1111-4111-8111-111111111111.${expiredSecret}`);

      const disabledSecret = 'disabled-secret';
      const disabledHash = await argon2.hash(
        disabledSecret,
        FAST_ARGON2_OPTIONS,
      );
      await captureFailure(() => {
        passwordResetTokenRepository.findOneBy.mockResolvedValueOnce(
          buildPasswordResetTokenRow({ tokenHash: disabledHash }),
        );
        usersService.findById.mockResolvedValueOnce(
          buildUser({ isActive: false }),
        );
      }, `11111111-1111-4111-8111-111111111111.${disabledSecret}`);

      expect(messages).toHaveLength(6);
      expect(new Set(messages)).toEqual(new Set(['Invalid or expired token']));
    });
  });

  describe('updateMe', () => {
    it('rejects an empty body without calling UsersService.update', async () => {
      await expect(service.updateMe('user-1', {})).rejects.toThrow(
        BadRequestException,
      );

      expect(usersService.update).not.toHaveBeenCalled();
    });

    it('forwards only the five profile fields to UsersService.update', async () => {
      const dto: UpdateMeDto = {
        firstName: 'Jane',
        lastName: 'Doe',
      };
      usersService.update.mockResolvedValue(
        buildUser({ firstName: 'Jane', lastName: 'Doe' }),
      );

      await service.updateMe('user-1', dto);

      expect(usersService.update).toHaveBeenCalledTimes(1);
      const [id, data] = usersService.update.mock.calls[0];
      expect(id).toBe('user-1');
      // `role`/`isActive` must never reach `UsersService.update`, even as `undefined` keys
      // that could be mistaken for "no change" -- a mutation flipping this to spread the raw
      // DTO would still pass a looser assertion here.
      expect(data).toEqual({
        username: undefined,
        email: undefined,
        firstName: 'Jane',
        lastName: 'Doe',
        phone: undefined,
      });
      expect(data).not.toHaveProperty('role');
      expect(data).not.toHaveProperty('isActive');
    });

    it('returns the updated user as a UserResponseDto', async () => {
      const updatedUser = buildUser({ phone: '+22890000000' });
      usersService.update.mockResolvedValue(updatedUser);

      const result = await service.updateMe('user-1', {
        phone: '+22890000000',
      });

      expect(result).toEqual(UserResponseDto.fromEntity(updatedUser));
    });

    it('translates a unique-violation race from UsersService.update into a 409', async () => {
      usersService.update.mockRejectedValue({ code: '23505' });

      await expect(
        service.updateMe('user-1', { username: 'taken' }),
      ).rejects.toThrow(ConflictException);
    });

    it('propagates a NotFoundException raised by UsersService.update unchanged', async () => {
      usersService.update.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      await expect(
        service.updateMe('user-1', { username: 'ghost' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
