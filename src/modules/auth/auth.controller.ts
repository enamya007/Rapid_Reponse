import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { StrictLoginThrottle } from '../../common/throttle/strict-login-throttle.decorator';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthService } from './auth.service';
import { Auth } from './decorators/auth.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Create a new user account and issue a token pair' })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiConflictResponse({ description: 'Username or email already in use' })
  register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Dedicated, stricter anti-brute-force rate limit (THROTTLE_LOGIN_*), on top of the
  // general-purpose API-wide limit. See `strict-login-throttle.decorator.ts`.
  @StrictLoginThrottle()
  @ApiOperation({
    summary: 'Authenticate with username/password and issue a token pair',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials, or account disabled',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Too many login attempts, try again later',
  })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token and issue a new token pair',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Invalid, expired or reused refresh token',
  })
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refresh(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  // Same dedicated anti-brute-force limiter as `login` (P6 contract D13): this route is a
  // password-guessing/account-enumeration surface too, so it deliberately shares that counter
  // rather than getting a separate, unconfigured one.
  @StrictLoginThrottle()
  @ApiOperation({
    summary:
      'Request a password reset email. Always responds 202 with the same body, whether or ' +
      'not the address belongs to an account (anti-enumeration, P6 contract D13).',
  })
  @ApiAcceptedResponse({
    description:
      'Always returned, regardless of whether the email exists or the account is active.',
    schema: {
      properties: {
        message: {
          type: 'string',
          example: 'If the account exists, a reset link has been sent.',
        },
      },
    },
  })
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @StrictLoginThrottle()
  @ApiOperation({
    summary:
      'Consume a password reset token: sets the new password and revokes every active ' +
      'refresh token for the account.',
  })
  @ApiNoContentResponse({ description: 'Password reset' })
  @ApiBadRequestResponse({
    description:
      'Invalid or expired token — returned identically for every failure mode (malformed ' +
      'token, unknown/used/expired token, wrong secret, disabled account; P6 contract D12).',
  })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.authService.resetPassword(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth()
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiNoContentResponse({
    description:
      'Refresh token revoked (idempotent: also returned for an already-invalid token)',
  })
  logout(
    @CurrentUser('id') userId: string,
    @Body() dto: RefreshTokenDto,
  ): Promise<void> {
    return this.authService.logout(userId, dto);
  }

  @Get('me')
  @Auth()
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  @ApiOkResponse({ type: UserResponseDto })
  me(@CurrentUser('id') userId: string): Promise<UserResponseDto> {
    return this.authService.me(userId);
  }

  @Patch('me')
  @Auth()
  @ApiOperation({
    summary: "Update the currently authenticated user's own profile fields",
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'No field provided' })
  @ApiConflictResponse({ description: 'username or email already in use' })
  updateMe(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateMeDto,
  ): Promise<UserResponseDto> {
    return this.authService.updateMe(userId, dto);
  }
}
