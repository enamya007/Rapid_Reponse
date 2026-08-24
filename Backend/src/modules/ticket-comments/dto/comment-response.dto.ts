import { ApiProperty } from '@nestjs/swagger';
import { TicketComment } from '../../tickets/entities/ticket-comment.entity';
import { CommentVisibility } from '../../tickets/enums/comment-visibility.enum';

// Nested `{ id, username }` projection of the comment's author, embedded in
// `CommentResponseDto` only. Deliberately NOT `UserSummaryDto` (`../../tickets/dto/user-summary.dto`):
// that DTO also carries `firstName`/`lastName`, which the P4 contract's `CommentResponseDto`
// shape (`docs/plan-P4-contracts.md` §5 — "author {id,username}|null") does not include. Not a
// standalone file, same pattern as `TicketCategorySummaryDto` in `ticket-response.dto.ts`.
class CommentAuthorDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  username: string;
}

// Manual response DTO with `fromEntity`, following the project-wide convention (see
// `TicketResponseDto`/`UserResponseDto`): never serializes the raw `TicketComment` entity, and
// never exposes `deletedAt`, `updatedAt`, `ticketId`, or anything from `User` beyond
// `{id, username}`.
export class CommentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ enum: CommentVisibility, enumName: 'CommentVisibility' })
  visibility: CommentVisibility;

  // `null` when `TicketComment.authorId` is `null` — the FK is `ON DELETE SET NULL`
  // (`docs/data-model.md` §2.10), so a comment can legitimately outlive its author's account.
  @ApiProperty({ type: CommentAuthorDto, nullable: true })
  author: CommentAuthorDto | null;

  @ApiProperty()
  createdAt: Date;

  // Requires `comment.author` to already be a loaded relation when non-null —
  // `TicketCommentsService` is responsible for that, this method never triggers a lazy load.
  static fromEntity(comment: TicketComment): CommentResponseDto {
    const dto = new CommentResponseDto();
    dto.id = comment.id;
    dto.body = comment.body;
    dto.visibility = comment.visibility;
    dto.author = comment.author
      ? { id: comment.author.id, username: comment.author.username }
      : null;
    dto.createdAt = comment.createdAt;
    return dto;
  }
}
