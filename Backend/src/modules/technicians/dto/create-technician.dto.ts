import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsStrongPassword } from '../../../common/validation/strong-password.decorator';
import { TechnicianSkillInputDto } from './technician-skill-input.dto';

// P5 contract §5 (`docs/plan-P5-contracts.md`) — figée.
export class CreateTechnicianDto {
  @ApiProperty({ example: 'jtech', minLength: 3, maxLength: 50 })
  @IsString()
  @Length(3, 50)
  username: string;

  @ApiProperty({ example: 'jtech@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  // Password policy shared with `RegisterDto` via `IsStrongPassword` (P6 contract D15,
  // `docs/plan-P6-contracts.md` §3) — the same decorator, not a hand-copied rule. This is
  // the fix for the T5.1b escalation: an ADMIN-created technician must not get a weaker
  // password policy than a self-registered CLIENT, and a single shared decorator is what
  // makes that structurally guaranteed instead of merely reviewed.
  @ApiProperty({ example: 'Str0ngP@ssw0rd', minLength: 10, maxLength: 72 })
  @IsStrongPassword()
  password: string;

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

  @ApiPropertyOptional({ example: '+1 555 123 4567', maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxConcurrentTickets?: number;

  // `@ValidateNested({ each: true })` alone would NOT validate the array items: without
  // `@Type(() => TechnicianSkillInputDto)`, `class-transformer` never turns the plain JSON
  // objects sent in `skills` into real `TechnicianSkillInputDto` instances first, so
  // `class-validator` has nothing typed to run its own decorators against (classic pitfall,
  // called out explicitly in the T5.1b brief).
  @ApiPropertyOptional({ type: () => [TechnicianSkillInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TechnicianSkillInputDto)
  skills?: TechnicianSkillInputDto[];
}
