import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { IsStrongPassword } from '../../../common/validation/strong-password.decorator';
import { UserRole } from '../enums/user-role.enum';

// P6.5 contract §3 (`docs/plan-P6.5-contracts.md`) — figée. ADMIN-side account creation.
export class CreateUserDto {
  @ApiProperty({ example: 'jdoe', minLength: 3, maxLength: 50 })
  @IsString()
  @Length(3, 50)
  username: string;

  @ApiProperty({ example: 'jdoe@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  // Same shared decorator as `RegisterDto` and `CreateTechnicianDto` (P6 D15): an
  // ADMIN-created account must not get a weaker password policy than a self-registered one,
  // and a single decorator is what makes that structurally true instead of merely reviewed.
  @ApiProperty({ example: 'Str0ngP@ssw0rd', minLength: 10, maxLength: 72 })
  @IsStrongPassword()
  password: string;

  // TECHNICIAN is accepted by the validator but rejected by the service with a 400 pointing at
  // `POST /technicians` (D1). Refusing it here, at the DTO level, would produce the generic
  // "role must be one of the following values" message and hide WHY the value is refused and
  // which route to use instead.
  @ApiPropertyOptional({
    enum: UserRole,
    enumName: 'UserRole',
    default: UserRole.CLIENT,
    description:
      'ADMIN or CLIENT. TECHNICIAN is rejected with 400 — use POST /technicians, which creates the account and its technician profile in one transaction (D1).',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ example: 'Jane', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional({ example: '+228 90 00 00 00', maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}
