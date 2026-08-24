import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

// Deliberately NOT `UpdateUserDto` (`../../users/dto/update-user.dto.ts`) reused via
// `PickType`/`OmitType`: this codebase has no precedent for mapped-type DTOs, and more
// importantly `UpdateUserDto` carries `role`/`isActive`, two fields a user must never be able
// to set on themselves. `password` is absent for the same reason as on `UpdateUserDto`: a
// credential change goes through `POST /auth/forgot-password`, not a profile edit.
export class UpdateMeDto {
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
}
