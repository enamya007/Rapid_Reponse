import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  PaginatedResponseDto,
} from '../../common/dto/paginated-response.dto';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { UnreadCountResponseDto } from './dto/unread-count-response.dto';
import { NotificationsService } from './notifications.service';

// P6 contract §7 (`docs/plan-P6-contracts.md`) — figée. Every route is `@Auth()` (any
// authenticated role) and D16-scoped by `NotificationsService` itself (`recipientId =
// currentUser.id`, no ADMIN override) — never by a controller-level role check, since a
// notification is a personal object, not a role-gated resource.
//
// Static routes are declared BEFORE `:id/read`, in the exact order the contract prescribes
// (`unread-count`, `read-all`, `:id/read`): defensive discipline carried over from P5's D10 —
// see `TechniciansController`'s own comment for why this matters regardless of whether THIS
// specific path shape could actually collide.
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary:
      "List the caller's own notifications, paginated, newest first (D16 — no ADMIN override)",
  })
  @ApiPaginatedResponse(NotificationResponseDto)
  async list(
    @Query() query: NotificationQueryDto,
    @CurrentUser() user: User,
  ): Promise<PaginatedResponseDto<NotificationResponseDto>> {
    return this.notificationsService.list(query, user.id);
  }

  @Get('unread-count')
  @Auth()
  @ApiOperation({ summary: "Count the caller's unread notifications" })
  @ApiOkResponse({ type: UnreadCountResponseDto })
  async unreadCount(
    @CurrentUser() user: User,
  ): Promise<UnreadCountResponseDto> {
    return this.notificationsService.unreadCount(user.id);
  }

  @Patch('read-all')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Mark all of the caller's notifications as read" })
  @ApiNoContentResponse()
  async readAll(@CurrentUser() user: User): Promise<void> {
    await this.notificationsService.markAllRead(user.id);
  }

  @Patch(':id/read')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Mark a single notification as read (idempotent — already read is still 204)',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({
    description:
      "Notification doesn't exist, OR belongs to a different recipient — deliberately never a 403, which would reveal its existence to a caller who cannot see it",
  })
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.notificationsService.markRead(id, user.id);
  }
}
