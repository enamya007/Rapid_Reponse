import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { CommentVisibility } from '../../tickets/enums/comment-visibility.enum';

// P4 contract §5 (`docs/plan-P4-contracts.md`) — figée. `visibility` defaults to `PUBLIC` when
// omitted, applied by `TicketCommentsService.create`, never by this DTO: consistent with
// `CreateTicketDto.priority`'s own comment, this DTO only validates what was actually sent.
// Whether the caller is even ALLOWED to request `INTERNAL` (ADMIN/TECHNICIAN only, per the
// "Décisions complémentaires figées pour T4.5" table — 403 for a CLIENT, no silent downgrade to
// PUBLIC) is a role-based business rule enforced in the service, not validated here.
export class CreateCommentDto {
  @ApiProperty({
    example: 'Le technicien est en route, arrivée estimée dans 30 minutes.',
    minLength: 1,
    maxLength: 5000,
  })
  @IsString()
  @Length(1, 5000)
  body: string;

  @ApiPropertyOptional({
    enum: CommentVisibility,
    enumName: 'CommentVisibility',
    default: CommentVisibility.PUBLIC,
    description:
      'INTERNAL is reserved to ADMIN/TECHNICIAN — a CLIENT sending INTERNAL is rejected with 403 (never silently downgraded to PUBLIC).',
  })
  @IsOptional()
  @IsEnum(CommentVisibility)
  visibility?: CommentVisibility;
}
