import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OwnershipGuard } from '../tickets/guards/ownership.guard';
import { User } from '../users/entities/user.entity';
import { AttachmentsService } from './attachments.service';
import { AttachmentResponseDto } from './dto/attachment-response.dto';
import { MulterFileLike } from './types/multer-file.interface';

const OWNERSHIP_FORBIDDEN_DESCRIPTION =
  'Not the owner, the assignee, nor an admin (OwnershipGuard)';

@ApiTags('attachments')
@Controller('tickets/:id/attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post()
  // Decorator ORDER matters here and is not simply top-to-bottom: TypeScript applies stacked
  // decorators bottom-up (the one closest to the method runs first). `@Auth()` must therefore
  // sit BELOW `@UseGuards(OwnershipGuard)` so it is applied first, making its own
  // `UseGuards(JwtAuthGuard, RolesGuard)` populate the metadata array before `OwnershipGuard`
  // is appended to it — giving the final execution order
  // `[JwtAuthGuard, RolesGuard, OwnershipGuard]`. `OwnershipGuard` reads `request.user`, which
  // only exists once `JwtAuthGuard` has run. Copied exactly from `tickets.controller.ts`'s own
  // documented pattern — do not reorder without re-checking there first.
  @UseGuards(OwnershipGuard)
  @Auth()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload an attachment to a ticket' })
  @ApiCreatedResponse({ type: AttachmentResponseDto })
  @ApiBadRequestResponse({ description: 'No file provided under "file"' })
  @ApiForbiddenResponse({ description: OWNERSHIP_FORBIDDEN_DESCRIPTION })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiPayloadTooLargeResponse({
    description: 'File size exceeds UPLOAD_MAX_SIZE_BYTES',
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'MIME type not in UPLOAD_ALLOWED_MIME_TYPES',
  })
  async upload(
    @Param('id', ParseUUIDPipe) ticketId: string,
    @UploadedFile() file: MulterFileLike | undefined,
    @CurrentUser() user: User,
  ): Promise<AttachmentResponseDto> {
    // 413/415 are thrown by `StorageService.upload` (via `AttachmentsService.upload`) and
    // propagate here unchanged — no try/catch: NestJS's exception layer turns any thrown
    // `HttpException` subclass into the matching HTTP status automatically.
    return this.attachmentsService.upload(ticketId, file, user);
  }

  @Get()
  @UseGuards(OwnershipGuard)
  @Auth()
  @ApiOperation({ summary: 'List the attachments of a ticket' })
  @ApiOkResponse({ type: AttachmentResponseDto, isArray: true })
  @ApiForbiddenResponse({ description: OWNERSHIP_FORBIDDEN_DESCRIPTION })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  async list(
    @Param('id', ParseUUIDPipe) ticketId: string,
  ): Promise<AttachmentResponseDto[]> {
    return this.attachmentsService.list(ticketId);
  }

  @Delete(':attId')
  // Same decorator-order requirement as `POST` above.
  @UseGuards(OwnershipGuard)
  @Auth()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Soft delete an attachment (its author, or an admin, only)',
  })
  @ApiNoContentResponse({ description: 'Attachment soft deleted' })
  @ApiForbiddenResponse({
    description: `${OWNERSHIP_FORBIDDEN_DESCRIPTION}; or the caller can see the ticket but is neither the attachment's author nor an admin`,
  })
  @ApiNotFoundResponse({
    description:
      'Ticket not found, or the attachment does not exist / does not belong to this ticket',
  })
  async remove(
    @Param('id', ParseUUIDPipe) ticketId: string,
    @Param('attId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.attachmentsService.remove(ticketId, attachmentId, user);
  }
}
