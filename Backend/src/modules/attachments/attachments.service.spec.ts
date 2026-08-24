import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeleteResult } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { StoredObject, UploadInput } from '../storage/storage.types';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { AttachmentsService } from './attachments.service';
import { Attachment } from './entities/attachment.entity';
import { MulterFileLike } from './types/multer-file.interface';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.username = 'jdoe';
  user.email = 'jdoe@example.com';
  user.role = UserRole.CLIENT;
  user.isActive = true;
  Object.assign(user, overrides);
  return user;
}

function buildAttachment(overrides: Partial<Attachment> = {}): Attachment {
  const attachment = new Attachment();
  attachment.id = 'attachment-1';
  attachment.ticketId = 'ticket-1';
  attachment.commentId = null;
  attachment.uploadedById = 'user-1';
  attachment.bucket = 'test-bucket';
  attachment.storageKey = 'tickets/ticket-1/attachments/uuid-file.pdf';
  attachment.originalName = 'file.pdf';
  attachment.mimeType = 'application/pdf';
  attachment.sizeBytes = '1024';
  attachment.checksum = null;
  attachment.createdAt = new Date('2026-08-06T10:00:00.000Z');
  attachment.deletedAt = null;
  Object.assign(attachment, overrides);
  return attachment;
}

function buildFile(overrides: Partial<MulterFileLike> = {}): MulterFileLike {
  return {
    buffer: Buffer.from('file-content'),
    mimetype: 'application/pdf',
    originalname: 'file.pdf',
    size: 1024,
    ...overrides,
  };
}

function buildStoredObject(
  overrides: Partial<StoredObject> = {},
): StoredObject {
  return {
    key: 'tickets/ticket-1/attachments/uuid-file.pdf',
    bucket: 'test-bucket',
    mimeType: 'application/pdf',
    size: 1024,
    ...overrides,
  };
}

describe('AttachmentsService', () => {
  let service: AttachmentsService;
  let attachmentRepository: {
    create: jest.Mock<Attachment, [Record<string, unknown>]>;
    save: jest.Mock<Promise<Attachment>, [Attachment]>;
    find: jest.Mock<Promise<Attachment[]>, [Record<string, unknown>]>;
    findOneBy: jest.Mock<Promise<Attachment | null>, [Record<string, unknown>]>;
    softDelete: jest.Mock<Promise<DeleteResult>, [string]>;
  };
  let storageService: {
    upload: jest.Mock<Promise<StoredObject>, [UploadInput]>;
    getPresignedDownloadUrl: jest.Mock<Promise<string>, [string, number?]>;
    delete: jest.Mock<Promise<void>, [string]>;
  };

  beforeEach(async () => {
    attachmentRepository = {
      create: jest.fn<Attachment, [Record<string, unknown>]>((plain) =>
        Object.assign(new Attachment(), plain),
      ),
      save: jest.fn<Promise<Attachment>, [Attachment]>((entity) =>
        Promise.resolve(entity),
      ),
      find: jest.fn<Promise<Attachment[]>, [Record<string, unknown>]>(),
      findOneBy: jest.fn<
        Promise<Attachment | null>,
        [Record<string, unknown>]
      >(),
      softDelete: jest.fn<Promise<DeleteResult>, [string]>(),
    };
    storageService = {
      upload: jest.fn<Promise<StoredObject>, [UploadInput]>(),
      getPresignedDownloadUrl: jest.fn<Promise<string>, [string, number?]>(),
      delete: jest.fn<Promise<void>, [string]>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttachmentsService,
        {
          provide: getRepositoryToken(Attachment),
          useValue: attachmentRepository,
        },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();

    service = module.get(AttachmentsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('upload', () => {
    const currentUser = buildUser({ id: 'user-1' });

    it('throws BadRequestException when no file is provided, and never touches storage nor the database', async () => {
      await expect(
        service.upload('ticket-1', undefined, currentUser),
      ).rejects.toThrow(BadRequestException);

      expect(storageService.upload).not.toHaveBeenCalled();
      expect(attachmentRepository.create).not.toHaveBeenCalled();
      expect(attachmentRepository.save).not.toHaveBeenCalled();
    });

    it('calls StorageService.upload with keyPrefix `tickets/<ticketId>/attachments` BEFORE any database write, then persists the row from the returned StoredObject', async () => {
      const callOrder: string[] = [];
      storageService.upload.mockImplementation(() => {
        callOrder.push('storage.upload');
        return Promise.resolve(buildStoredObject());
      });
      attachmentRepository.create.mockImplementation((plain) => {
        callOrder.push('repository.create');
        return Object.assign(new Attachment(), plain);
      });
      attachmentRepository.save.mockImplementation((entity) => {
        callOrder.push('repository.save');
        return Promise.resolve(buildAttachment(entity));
      });
      storageService.getPresignedDownloadUrl.mockResolvedValue(
        'https://signed.example.com/object',
      );

      const file = buildFile();
      await service.upload('ticket-1', file, currentUser);

      expect(storageService.upload).toHaveBeenCalledWith({
        buffer: file.buffer,
        mimeType: file.mimetype,
        size: file.size,
        originalName: file.originalname,
        keyPrefix: 'tickets/ticket-1/attachments',
      });
      // The order itself is the load-bearing assertion: StorageService validates size/MIME
      // and uploads to S3 BEFORE the DB is touched at all (P4 contract, "Ordre des
      // opérations à l'upload").
      expect(callOrder).toEqual([
        'storage.upload',
        'repository.create',
        'repository.save',
      ]);
      expect(attachmentRepository.create).toHaveBeenCalledWith({
        ticketId: 'ticket-1',
        commentId: null,
        uploadedById: 'user-1',
        bucket: 'test-bucket',
        storageKey: 'tickets/ticket-1/attachments/uuid-file.pdf',
        originalName: 'file.pdf',
        mimeType: 'application/pdf',
        sizeBytes: '1024',
      });
    });

    it('returns an AttachmentResponseDto with sizeBytes as a number and downloadUrl from getPresignedDownloadUrl', async () => {
      storageService.upload.mockResolvedValue(
        buildStoredObject({ size: 2048 }),
      );
      const saved = buildAttachment({ sizeBytes: '2048' });
      attachmentRepository.save.mockResolvedValue(saved);
      storageService.getPresignedDownloadUrl.mockResolvedValue(
        'https://signed.example.com/object',
      );

      const result = await service.upload('ticket-1', buildFile(), currentUser);

      expect(result.sizeBytes).toBe(2048);
      expect(typeof result.sizeBytes).toBe('number');
      expect(result.downloadUrl).toBe('https://signed.example.com/object');
      expect(storageService.getPresignedDownloadUrl).toHaveBeenCalledWith(
        saved.storageKey,
      );
      expect(Object.keys(result).sort()).toEqual(
        [
          'id',
          'originalName',
          'mimeType',
          'sizeBytes',
          'createdAt',
          'downloadUrl',
        ].sort(),
      );
    });

    it('propagates PayloadTooLargeException from StorageService.upload and writes nothing to the database', async () => {
      storageService.upload.mockRejectedValue(
        new PayloadTooLargeException('too big'),
      );

      await expect(
        service.upload('ticket-1', buildFile(), currentUser),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);

      expect(attachmentRepository.create).not.toHaveBeenCalled();
      expect(attachmentRepository.save).not.toHaveBeenCalled();
    });

    it('propagates UnsupportedMediaTypeException from StorageService.upload and writes nothing to the database', async () => {
      storageService.upload.mockRejectedValue(
        new UnsupportedMediaTypeException('bad mime'),
      );

      await expect(
        service.upload('ticket-1', buildFile(), currentUser),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);

      expect(attachmentRepository.create).not.toHaveBeenCalled();
      expect(attachmentRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns each attachment as AttachmentResponseDto with a resolved downloadUrl, ordered by createdAt ASC', async () => {
      const attachment1 = buildAttachment({ id: 'attachment-1' });
      const attachment2 = buildAttachment({ id: 'attachment-2' });
      attachmentRepository.find.mockResolvedValue([attachment1, attachment2]);
      storageService.getPresignedDownloadUrl.mockResolvedValue(
        'https://signed.example.com/object',
      );

      const result = await service.list('ticket-1');

      expect(attachmentRepository.find).toHaveBeenCalledWith({
        where: { ticketId: 'ticket-1' },
        order: { createdAt: 'ASC' },
      });
      expect(result).toHaveLength(2);
      expect(result[0].downloadUrl).toBe('https://signed.example.com/object');
      expect(result[1].downloadUrl).toBe('https://signed.example.com/object');
    });

    it('sets downloadUrl to null for an attachment whose presigned URL generation fails, while still returning the other attachments', async () => {
      const attachment1 = buildAttachment({
        id: 'attachment-1',
        storageKey: 'key-that-fails',
      });
      const attachment2 = buildAttachment({
        id: 'attachment-2',
        storageKey: 'key-that-succeeds',
      });
      attachmentRepository.find.mockResolvedValue([attachment1, attachment2]);
      storageService.getPresignedDownloadUrl.mockImplementation((key) => {
        if (key === 'key-that-fails') {
          return Promise.reject(new Error('S3 unreachable'));
        }
        return Promise.resolve('https://signed.example.com/object');
      });

      const result = await service.list('ticket-1');

      expect(result).toHaveLength(2);
      const failed = result.find((dto) => dto.id === 'attachment-1');
      const succeeded = result.find((dto) => dto.id === 'attachment-2');
      expect(failed?.downloadUrl).toBeNull();
      expect(succeeded?.downloadUrl).toBe('https://signed.example.com/object');
    });

    it('never leaks storageKey/bucket/uploadedById/ticketId/commentId/deletedAt/checksum through the DTO', async () => {
      attachmentRepository.find.mockResolvedValue([buildAttachment()]);
      storageService.getPresignedDownloadUrl.mockResolvedValue(
        'https://signed.example.com/object',
      );

      const [result] = await service.list('ticket-1');

      expect(Object.keys(result).sort()).toEqual(
        [
          'id',
          'originalName',
          'mimeType',
          'sizeBytes',
          'createdAt',
          'downloadUrl',
        ].sort(),
      );
    });
  });

  describe('remove', () => {
    const AUTHOR = buildUser({ id: 'author-1', role: UserRole.CLIENT });
    const ADMIN = buildUser({ id: 'admin-1', role: UserRole.ADMIN });
    const OTHER_CLIENT = buildUser({ id: 'other-1', role: UserRole.CLIENT });

    it('throws NotFoundException when the attachment does not exist, and never calls softDelete', async () => {
      attachmentRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.remove('ticket-1', 'missing-id', AUTHOR),
      ).rejects.toThrow(NotFoundException);

      expect(attachmentRepository.softDelete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the attachment belongs to a DIFFERENT ticket than the one in the URL, and never calls softDelete (no cross-ticket leak)', async () => {
      const attachment = buildAttachment({
        id: 'attachment-1',
        ticketId: 'some-other-ticket',
        uploadedById: AUTHOR.id,
      });
      attachmentRepository.findOneBy.mockResolvedValue(attachment);

      await expect(
        service.remove('ticket-1', 'attachment-1', AUTHOR),
      ).rejects.toThrow(NotFoundException);

      expect(attachmentRepository.softDelete).not.toHaveBeenCalled();
    });

    it('allows the author to soft delete: calls softDelete with the id, and never calls StorageService.delete', async () => {
      const attachment = buildAttachment({
        id: 'attachment-1',
        ticketId: 'ticket-1',
        uploadedById: AUTHOR.id,
      });
      attachmentRepository.findOneBy.mockResolvedValue(attachment);
      attachmentRepository.softDelete.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await service.remove('ticket-1', 'attachment-1', AUTHOR);

      expect(attachmentRepository.softDelete).toHaveBeenCalledWith(
        'attachment-1',
      );
      expect(storageService.delete).not.toHaveBeenCalled();
    });

    it('allows an ADMIN, even when not the author, to soft delete', async () => {
      const attachment = buildAttachment({
        id: 'attachment-1',
        ticketId: 'ticket-1',
        uploadedById: AUTHOR.id,
      });
      attachmentRepository.findOneBy.mockResolvedValue(attachment);
      attachmentRepository.softDelete.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await service.remove('ticket-1', 'attachment-1', ADMIN);

      expect(attachmentRepository.softDelete).toHaveBeenCalledWith(
        'attachment-1',
      );
      expect(storageService.delete).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for a caller who is neither the author nor an admin, and never calls softDelete', async () => {
      const attachment = buildAttachment({
        id: 'attachment-1',
        ticketId: 'ticket-1',
        uploadedById: AUTHOR.id,
      });
      attachmentRepository.findOneBy.mockResolvedValue(attachment);

      await expect(
        service.remove('ticket-1', 'attachment-1', OTHER_CLIENT),
      ).rejects.toThrow(ForbiddenException);

      expect(attachmentRepository.softDelete).not.toHaveBeenCalled();
      expect(storageService.delete).not.toHaveBeenCalled();
    });
  });
});
