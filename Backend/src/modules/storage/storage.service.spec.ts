import {
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { storageConfig, StorageConfig } from '../../config/storage.config';
import { STORAGE_S3_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';
import { UploadInput } from './storage.types';

jest.mock('@aws-sdk/s3-request-presigner');

const mockedGetSignedUrl = getSignedUrl as jest.MockedFunction<
  typeof getSignedUrl
>;

type SentCommand = PutObjectCommand | GetObjectCommand | DeleteObjectCommand;

// A version-4 UUID (as produced by `node:crypto`'s `randomUUID()`), used to assert the shape
// of the generated object key without pinning down its exact (random) value.
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MOCK_STORAGE_CONFIG: StorageConfig = {
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  bucket: 'test-bucket',
  accessKey: 'test-access-key',
  secretKey: 'test-secret-key',
  forcePathStyle: true,
  publicUrl: undefined,
  uploadMaxSizeBytes: 1024,
  // Deliberately padded with surrounding whitespace to prove the CSV is trimmed.
  uploadAllowedMimeTypes: 'image/png, application/pdf',
};

function buildUploadInput(overrides: Partial<UploadInput> = {}): UploadInput {
  return {
    buffer: Buffer.from('file-content'),
    mimeType: 'application/pdf',
    size: 512,
    originalName: 'report.pdf',
    keyPrefix: 'tickets/1/attachments',
    ...overrides,
  };
}

describe('StorageService', () => {
  let service: StorageService;
  let s3Client: { send: jest.Mock<Promise<unknown>, [SentCommand]> };

  beforeEach(async () => {
    s3Client = { send: jest.fn<Promise<unknown>, [SentCommand]>() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: STORAGE_S3_CLIENT, useValue: s3Client },
        { provide: storageConfig.KEY, useValue: MOCK_STORAGE_CONFIG },
      ],
    }).compile();

    service = module.get(StorageService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('upload', () => {
    it('validates size and MIME type, then uploads the buffer with a generated key and returns the stored object', async () => {
      s3Client.send.mockResolvedValue({});

      const result = await service.upload(buildUploadInput());

      expect(s3Client.send).toHaveBeenCalledTimes(1);
      const command = s3Client.send.mock.calls[0][0];
      expect(command).toBeInstanceOf(PutObjectCommand);

      const key = command.input.Key;
      expect(key).toBeDefined();
      expect(key!.startsWith('tickets/1/attachments/')).toBe(true);
      expect(key!.endsWith('-report.pdf')).toBe(true);
      const uuidPart = key!.slice(
        'tickets/1/attachments/'.length,
        -'-report.pdf'.length,
      );
      expect(uuidPart).toMatch(UUID_V4_PATTERN);

      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: key,
        Body: Buffer.from('file-content'),
        ContentType: 'application/pdf',
        ContentLength: 512,
      });

      expect(result).toEqual({
        key,
        bucket: 'test-bucket',
        mimeType: 'application/pdf',
        size: 512,
      });
    });

    it('falls back to the default "uploads" prefix when no keyPrefix is provided', async () => {
      s3Client.send.mockResolvedValue({});

      const result = await service.upload(
        buildUploadInput({ keyPrefix: undefined }),
      );

      expect(result.key.startsWith('uploads/')).toBe(true);
    });

    it('strips path-traversal and other unsafe characters from the original file name while keeping the extension', async () => {
      s3Client.send.mockResolvedValue({});

      const result = await service.upload(
        buildUploadInput({ originalName: '../../etc/weird name?.pdf' }),
      );

      // The path-separator-containing prefix is dropped (only the last path segment is kept),
      // and remaining unsafe characters (spaces, '?') are replaced — the '.pdf' extension and
      // safe characters survive untouched.
      expect(result.key).not.toContain('..');
      expect(result.key).not.toContain('?');
      expect(result.key).not.toContain(' ');
      expect(result.key.endsWith('-weird-name-.pdf')).toBe(true);
    });

    it('rejects with PayloadTooLargeException when size exceeds the configured maximum, without calling the S3 client', async () => {
      await expect(
        service.upload(
          buildUploadInput({
            size: MOCK_STORAGE_CONFIG.uploadMaxSizeBytes + 1,
          }),
        ),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);

      expect(s3Client.send).not.toHaveBeenCalled();
    });

    it('accepts a file exactly at the configured maximum size', async () => {
      s3Client.send.mockResolvedValue({});

      await expect(
        service.upload(
          buildUploadInput({ size: MOCK_STORAGE_CONFIG.uploadMaxSizeBytes }),
        ),
      ).resolves.toBeDefined();

      expect(s3Client.send).toHaveBeenCalledTimes(1);
    });

    it('rejects with UnsupportedMediaTypeException when the MIME type is not allowed, without calling the S3 client', async () => {
      await expect(
        service.upload(
          buildUploadInput({ mimeType: 'application/x-msdownload' }),
        ),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);

      expect(s3Client.send).not.toHaveBeenCalled();
    });

    it('accepts a MIME type from the allowed list after trimming surrounding whitespace in the CSV config', async () => {
      s3Client.send.mockResolvedValue({});

      await expect(
        service.upload(buildUploadInput({ mimeType: 'image/png' })),
      ).resolves.toBeDefined();

      expect(s3Client.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPresignedDownloadUrl', () => {
    it('returns the URL produced by getSignedUrl, defaulting to a 900 second expiry', async () => {
      mockedGetSignedUrl.mockResolvedValue('https://signed.example.com/object');

      const url = await service.getPresignedDownloadUrl('tickets/1/file.pdf');

      expect(url).toBe('https://signed.example.com/object');
      expect(mockedGetSignedUrl).toHaveBeenCalledTimes(1);
      const [client, command, options] = mockedGetSignedUrl.mock.calls[0];
      expect(client).toBe(s3Client);
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect((command as GetObjectCommand).input).toEqual({
        Bucket: 'test-bucket',
        Key: 'tickets/1/file.pdf',
      });
      expect(options).toEqual({ expiresIn: 900 });
    });

    it('respects an explicit expiresInSeconds override', async () => {
      mockedGetSignedUrl.mockResolvedValue('https://signed.example.com/object');

      await service.getPresignedDownloadUrl('tickets/1/file.pdf', 60);

      expect(mockedGetSignedUrl).toHaveBeenCalledTimes(1);
      const [, , options] = mockedGetSignedUrl.mock.calls[0];
      expect(options).toEqual({ expiresIn: 60 });
    });
  });

  describe('delete', () => {
    it('sends a DeleteObjectCommand for the given key', async () => {
      s3Client.send.mockResolvedValue({});

      await service.delete('tickets/1/file.pdf');

      expect(s3Client.send).toHaveBeenCalledTimes(1);
      const command = s3Client.send.mock.calls[0][0];
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'tickets/1/file.pdf',
      });
    });
  });
});
