import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { parseBooleanQuery } from '../../../common/utils/parse-boolean-query.util';

// P6 contract §7 (`docs/plan-P6-contracts.md`) — figée. `unreadOnly` reuses the shared
// `parseBooleanQuery` (D18) rather than re-deriving the `enableImplicitConversion` fix a second
// time — see that function's own doc comment for the full mechanism. `?unreadOnly=false` MUST
// behave exactly like the parameter being absent (this is the case that demasked the bug this
// utility fixes, in P5).
export class NotificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'When true, only unread notifications are returned. Omitted or false (D18) returns every notification.',
  })
  @IsOptional()
  @Transform(parseBooleanQuery)
  @IsBoolean()
  unreadOnly?: boolean;
}
