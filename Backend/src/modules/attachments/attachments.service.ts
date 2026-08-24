import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { AttachmentResponseDto } from './dto/attachment-response.dto';
import { Attachment } from './entities/attachment.entity';
import { MulterFileLike } from './types/multer-file.interface';

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    @InjectRepository(Attachment)
    private readonly attachmentRepository: Repository<Attachment>,
    private readonly storageService: StorageService,
  ) {}

  // `POST /tickets/:id/attachments` (P4 contract §4/§"Règles fines"). Ticket visibility
  // (403/404) is already enforced upstream by `OwnershipGuard`; this method only owns what the
  // guard cannot: "was a file actually provided" (400) and the upload itself.
  //
  // Order of operations matters (P4 contract, "Ordre des opérations à l'upload"):
  //   1. `StorageService.upload` FIRST — it validates size/MIME type itself and throws
  //      `PayloadTooLargeException`/`UnsupportedMediaTypeException` (413/415) before anything is
  //      written to the database.
  //   2. Only once the object actually exists in S3 is the `attachments` row persisted, built
  //      from the `StoredObject` the upload returned (never from the raw `file` for
  //      `bucket`/`storageKey`/`mimeType`/`sizeBytes`).
  async upload(
    ticketId: string,
    file: MulterFileLike | undefined,
    currentUser: User,
  ): Promise<AttachmentResponseDto> {
    if (!file) {
      throw new BadRequestException(
        'A file must be provided under the "file" field',
      );
    }

    const stored = await this.storageService.upload({
      buffer: file.buffer,
      mimeType: file.mimetype,
      size: file.size,
      originalName: file.originalname,
      // P4 contract D4: `commentId` stays `null` in P4 — no upload-under-comment endpoint
      // exists yet, and the `CHECK` constraint is already satisfied by `ticketId`.
      keyPrefix: `tickets/${ticketId}/attachments`,
    });

    const attachment = this.attachmentRepository.create({
      ticketId,
      commentId: null,
      uploadedById: currentUser.id,
      bucket: stored.bucket,
      storageKey: stored.key,
      originalName: file.originalname,
      mimeType: stored.mimeType,
      // `Attachment.sizeBytes` is a `bigint` column (stored as a `string` on the TS side, see
      // the entity's own comment) — `StoredObject.size` is a plain `number` of bytes.
      sizeBytes: String(stored.size),
    });
    const saved = await this.attachmentRepository.save(attachment);

    const downloadUrl = await this.resolveDownloadUrl(saved.storageKey);
    return AttachmentResponseDto.fromEntity(saved, downloadUrl);
  }

  // `GET /tickets/:id/attachments` (P4 contract §4/§5). Ticket visibility is `OwnershipGuard`'s
  // job; this only lists the (non soft-deleted, by TypeORM's default `@DeleteDateColumn`
  // behaviour) attachments of the given ticket, each carrying a freshly generated presigned
  // download URL.
  async list(ticketId: string): Promise<AttachmentResponseDto[]> {
    const attachments = await this.attachmentRepository.find({
      where: { ticketId },
      order: { createdAt: 'ASC' },
    });

    return Promise.all(
      attachments.map(async (attachment) => {
        const downloadUrl = await this.resolveDownloadUrl(
          attachment.storageKey,
        );
        return AttachmentResponseDto.fromEntity(attachment, downloadUrl);
      }),
    );
  }

  // `DELETE /tickets/:id/attachments/:attId` (P4 contract §4/D5). `OwnershipGuard` only covers
  // ticket-level visibility (it reads `params.id` alone); the finer "author or ADMIN" rule, and
  // the "does this attachment even belong to THIS ticket" check (to avoid leaking
  // existence/ownership info across tickets via a crafted `attId`), both live here.
  async remove(
    ticketId: string,
    attachmentId: string,
    currentUser: User,
  ): Promise<void> {
    // `findOneBy` implicitly excludes already soft-deleted rows (TypeORM's default behaviour
    // for `@DeleteDateColumn`), so a second delete attempt also surfaces as 404, not a no-op 204.
    const attachment = await this.attachmentRepository.findOneBy({
      id: attachmentId,
    });
    if (!attachment || attachment.ticketId !== ticketId) {
      throw new NotFoundException('Attachment not found');
    }

    const isAdmin = currentUser.role === UserRole.ADMIN;
    const isAuthor = attachment.uploadedById === currentUser.id;
    if (!isAdmin && !isAuthor) {
      throw new ForbiddenException(
        'Insufficient permissions to delete this attachment',
      );
    }

    // Soft delete of the ROW ONLY: `Attachment.deletedAt` is a `@DeleteDateColumn`, so this
    // issues an `UPDATE ... SET deleted_at = now()`, never a `DELETE FROM`. The S3 binary is
    // deliberately NOT removed in P4 (`StorageService.delete` is never called here) — cleanup of
    // orphaned objects is differed to a later phase (P4 contract, "Règles fines" / D5).
    await this.attachmentRepository.softDelete(attachmentId);
  }

  // A failed presigned-URL generation for ONE attachment must not break the whole
  // list/response (P4 contract §5): logged as a warning, surfaced to the caller as `null`.
  private async resolveDownloadUrl(storageKey: string): Promise<string | null> {
    try {
      return await this.storageService.getPresignedDownloadUrl(storageKey);
    } catch (error) {
      this.logger.warn(
        `Failed to generate a presigned download URL for storage key "${storageKey}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
