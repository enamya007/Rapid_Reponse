import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { TicketPriority } from '../enums/ticket-priority.enum';
import { TicketStatus } from '../enums/ticket-status.enum';

// Whitelist of sortable columns for `GET /tickets` (P4 contract §5). This IS the single
// source of truth: `TicketsService`'s column-name map (`SORT_COLUMNS`) is typed as
// `Record<(typeof TICKET_SORT_FIELDS)[number], string>`, so TypeScript itself (not just this
// DTO's `@IsIn` validation) requires a matching entry there for every value listed here —
// adding one here without extending `SORT_COLUMNS` fails `pnpm build`, it does not silently
// diverge at runtime. `sort`/`order` are never interpolated into SQL without going through a
// validated, explicit whitelist first (defense against injection via `ORDER BY`).
export const TICKET_SORT_FIELDS = [
  'createdAt',
  'priority',
  'slaDueAt',
  'status',
] as const;

const TICKET_SORT_ORDERS = ['ASC', 'DESC'] as const;

/**
 * Query-string DTO for `GET /tickets` (P4 contract §5). Composes the generic
 * `PaginationQueryDto` (`page`/`limit`) with ticket-specific filters, free-text search and
 * sorting. `assigneeId`/`createdById` are only honored for `ADMIN` callers — for
 * `CLIENT`/`TECHNICIAN`, `TicketsService.list` forces its own role-based scope and ignores
 * whatever value is supplied here (see that method's doc comment).
 */
export class TicketQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TicketStatus, enumName: 'TicketStatus' })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: TicketPriority, enumName: 'TicketPriority' })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Honored for ADMIN callers only',
  })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Honored for ADMIN callers only',
  })
  @IsOptional()
  @IsUUID()
  createdById?: string;

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'Free-text search on title and reference (case-insensitive)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    enum: TICKET_SORT_FIELDS,
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(TICKET_SORT_FIELDS)
  sort?: string;

  @ApiPropertyOptional({
    enum: TICKET_SORT_ORDERS,
    default: 'DESC',
  })
  @IsOptional()
  @IsIn(TICKET_SORT_ORDERS)
  order?: 'ASC' | 'DESC';
}
