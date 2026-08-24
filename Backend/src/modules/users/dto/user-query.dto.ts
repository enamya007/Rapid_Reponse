import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { parseBooleanQuery } from '../../../common/utils/parse-boolean-query.util';
import { UserRole } from '../enums/user-role.enum';

// P6.5 contract §3 (`docs/plan-P6.5-contracts.md`) — figée. `isActive` goes through the shared
// `parseBooleanQuery` (P6 D18) rather than relying on `enableImplicitConversion`, which turns
// the string `'false'` into `true`.
export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserRole, enumName: 'UserRole' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'Filter by User.isActive' })
  @IsOptional()
  @Transform(parseBooleanQuery)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Case-insensitive partial match on username, email, firstName or lastName',
    minLength: 1,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  search?: string;
}
