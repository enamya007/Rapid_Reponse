import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { UserRole } from '../enums/user-role.enum';

// P6.5 contract §3 (`docs/plan-P6.5-contracts.md`) — figée. Every field is optional; the "at
// least one field must be provided" rule (-> 400 otherwise) is enforced by the service, same
// pattern as `UpdateTechnicianDto`/`UpdateTicketDto`.
//
// `password` is deliberately absent: changing someone else's password is a credential
// operation, not a profile edit. A forgotten password goes through
// `POST /auth/forgot-password` (P6 T6.5), which proves control of the mailbox — an ADMIN-set
// password would have to be transmitted out of band and would be known by two people.
export class UpdateUserDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 50 })
  @IsOptional()
  @IsString()
  @Length(3, 50)
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  // D2: a change to or from TECHNICIAN is rejected by the service (400) — see
  // `UsersService.adminUpdate`.
  @ApiPropertyOptional({
    enum: UserRole,
    enumName: 'UserRole',
    description:
      'ADMIN <-> CLIENT only. Any change to or from TECHNICIAN is rejected with 400 (D2).',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    description:
      'Deactivating an account takes effect on the very next request: JwtStrategy re-reads the user and rejects an inactive one (D5).',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
