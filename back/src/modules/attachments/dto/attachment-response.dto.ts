import { ApiProperty } from '@nestjs/swagger';
import { Attachment } from '../entities/attachment.entity';

// Manual response DTO with `fromEntity`, following the project-wide convention (see
// `TicketResponseDto`/`UserResponseDto`): never serializes the raw `Attachment` entity, never
// leaks `storageKey`/`bucket`/`uploadedById`/`checksum`/`ticketId`/`commentId`/`deletedAt` — only
// the fields figured in the P4 contract (`docs/plan-P4-contracts.md` §5).
export class AttachmentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  originalName: string;

  @ApiProperty()
  mimeType: string;

  // `Attachment.sizeBytes` is a `bigint` column, rendered as a `string` by the Postgres driver
  // (see the entity's own comment) — a `string` would leak that infrastructure detail into the
  // API. Converted to a `number` here (P4 contract D3); safe because `UPLOAD_MAX_SIZE_BYTES`
  // bounds every stored value to well below `Number.MAX_SAFE_INTEGER`.
  @ApiProperty()
  sizeBytes: number;

  @ApiProperty()
  createdAt: Date;

  // Presigned URL (`StorageService.getPresignedDownloadUrl`), never persisted. `null` when
  // presigned URL generation failed for this attachment — the caller still gets the rest of the
  // metadata instead of the whole list breaking (P4 contract §5).
  @ApiProperty({ nullable: true, type: String })
  downloadUrl: string | null;

  // `downloadUrl` is resolved by the caller (an async call to `StorageService`) and passed in
  // separately, rather than computed here, so this mapping itself stays synchronous.
  static fromEntity(
    entity: Attachment,
    downloadUrl: string | null,
  ): AttachmentResponseDto {
    const dto = new AttachmentResponseDto();
    dto.id = entity.id;
    dto.originalName = entity.originalName;
    dto.mimeType = entity.mimeType;
    dto.sizeBytes = Number(entity.sizeBytes);
    dto.createdAt = entity.createdAt;
    dto.downloadUrl = downloadUrl;
    return dto;
  }
}
