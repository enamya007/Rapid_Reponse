import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsStrongPassword } from '../../../common/validation/strong-password.decorator';

// `role` is deliberately absent: a self-registered account is always created as `CLIENT`
// (enforced by `AuthService.register`/`UsersService.create`, never by trusting client input).
// The global `ValidationPipe`'s `forbidNonWhitelisted` rejects any `role` sent in the request
// body with a 400, since this DTO has no matching property.
export class RegisterDto {
  @ApiProperty({ example: 'jdoe' })
  @IsString()
  @Length(3, 50)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message:
      'username may only contain letters, numbers, dots, underscores and hyphens',
  })
  username: string;

  @ApiProperty({ example: 'jdoe@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  // Password complexity policy — see `IsStrongPassword`'s own doc comment
  // (`src/common/validation/strong-password.decorator.ts`) for why the bounds are 10 and
  // 72: the 10 comes from the spec (cahier des charges §6.3), the 72 is an anti-DoS guard
  // sized for Argon2's memory-hardness, NOT bcrypt's 72-byte truncation limit.
  @ApiProperty({ example: 'Str0ngP@ssw0rd', minLength: 10, maxLength: 72 })
  @IsStrongPassword()
  password: string;

  @ApiProperty({ example: 'Jane', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @ApiProperty({ example: 'Doe', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiProperty({ example: '+1 555 123 4567', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}
