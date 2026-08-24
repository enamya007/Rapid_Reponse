import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { IsStrongPassword } from '../../../common/validation/strong-password.decorator';

export class ResetPasswordDto {
  // Opaque `<row id>.<secret>` value handed out by `POST /auth/forgot-password`'s email link
  // (P6 contract D11). Never parsed/shaped further here: a malformed value is just one more
  // way `AuthService.resetPassword` reaches its single, uniform 400 (D12).
  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6.k3f9...base64url-secret',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  // Same complexity policy as registration (P6 contract D15) — never redeclared by hand here,
  // see `IsStrongPassword`'s own doc comment for why that matters.
  @ApiProperty({ example: 'Str0ngP@ssw0rd', minLength: 10, maxLength: 72 })
  @IsStrongPassword()
  newPassword: string;
}
