import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  PaginatedResponseDto,
} from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OwnershipGuard } from '../tickets/guards/ownership.guard';
import { User } from '../users/entities/user.entity';
import { CommentResponseDto } from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { TicketCommentsService } from './ticket-comments.service';

@ApiTags('tickets')
@Controller('tickets/:id/comments')
export class TicketCommentsController {
  constructor(private readonly ticketCommentsService: TicketCommentsService) {}

  @Post()
  // Decorator ORDER matters here and is not simply top-to-bottom: TypeScript applies stacked
  // decorators bottom-up (the one closest to the method runs first). `@Auth()` must therefore
  // sit BELOW `@UseGuards(OwnershipGuard)` so it is applied first, making its own
  // `UseGuards(JwtAuthGuard, RolesGuard)` populate the metadata array before `OwnershipGuard`
  // is appended to it — giving the final execution order `[JwtAuthGuard, RolesGuard,
  // OwnershipGuard]`. `OwnershipGuard` reads `request.user`, which only exists once
  // `JwtAuthGuard` has run; swapping this order would make it always throw. Copied verbatim
  // from `TicketsController`'s own transition routes (P4 contract §4) — see that file's
  // identical comment.
  @UseGuards(OwnershipGuard)
  @Auth()
  @ApiOperation({ summary: 'Post a comment on a ticket' })
  @ApiCreatedResponse({ type: CommentResponseDto })
  @ApiBadRequestResponse({
    description: 'body missing/empty/too long, or an invalid visibility value',
  })
  @ApiForbiddenResponse({
    description:
      'OwnershipGuard rejected the caller (not owner/assignee/admin), or a CLIENT attempted to post an INTERNAL comment',
  })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  async create(
    @Param('id', ParseUUIDPipe) ticketId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: User,
  ): Promise<CommentResponseDto> {
    const comment = await this.ticketCommentsService.create(
      ticketId,
      dto,
      user,
    );
    return CommentResponseDto.fromEntity(comment);
  }

  @Get()
  // Decorator ORDER matters here — see the identical comment on `create()` above.
  @UseGuards(OwnershipGuard)
  @Auth()
  @ApiOperation({
    summary:
      "List a ticket's comments, paginated and sorted chronologically (createdAt ASC); INTERNAL comments are excluded for a CLIENT caller",
  })
  @ApiPaginatedResponse(CommentResponseDto)
  @ApiForbiddenResponse({
    description: 'Not the owner, the assignee, nor an admin',
  })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  async list(
    @Param('id', ParseUUIDPipe) ticketId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: User,
  ): Promise<PaginatedResponseDto<CommentResponseDto>> {
    return this.ticketCommentsService.list(ticketId, query, user);
  }
}
