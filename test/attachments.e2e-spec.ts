import { randomUUID } from 'node:crypto';
import {
  INestApplication,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Attachment } from '../src/modules/attachments/entities/attachment.entity';
import { Category } from '../src/modules/categories/entities/category.entity';
import { StorageService } from '../src/modules/storage/storage.service';
import {
  StoredObject,
  UploadInput,
} from '../src/modules/storage/storage.types';
import { Ticket } from '../src/modules/tickets/entities/ticket.entity';
import { UserRole } from '../src/modules/users/enums/user-role.enum';
import { UsersService } from '../src/modules/users/users.service';

interface AuthResponseBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string };
}

interface AttachmentResponseBody {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string | null;
}

interface CountRow {
  count: number;
}

// `att_e2e_` — NOT `e2e_%` (wiped by `auth.e2e-spec.ts`'s own `beforeAll`/`afterAll`), NOT
// `tickets_e2e_%` nor `tcm_e2e_%` (other suites' own, unrelated, fixtures), so this suite's data
// can never be deleted mid-run by another spec file, nor vice versa. Jest runs e2e specs serially
// (`maxWorkers: 1`, `test/jest-e2e.json`) against one shared, real database.
const OWNER = {
  username: 'att_e2e_owner',
  email: 'att_e2e_owner@test.local',
  password: 'AttE2eOwner123',
};
const OTHER_CLIENT = {
  username: 'att_e2e_other_client',
  email: 'att_e2e_other_client@test.local',
  password: 'AttE2eOther123',
};
// Neither TECHNICIAN nor ADMIN can self-register (`RegisterDto` has no `role` field): both are
// created directly through `UsersService`, exactly like `tickets.e2e-spec.ts`'s own technician
// fixture, then authenticated through the REAL `/api/auth/login` so every test below exercises
// the genuine JWT/guard path, not a hand-crafted token.
const ASSIGNED_TECH = {
  username: 'att_e2e_tech_assigned',
  email: 'att_e2e_tech_assigned@test.local',
  password: 'AttE2eTechA123',
};
const OTHER_TECH = {
  username: 'att_e2e_tech_other',
  email: 'att_e2e_tech_other@test.local',
  password: 'AttE2eTechO123',
};
const ADMIN = {
  username: 'att_e2e_admin',
  email: 'att_e2e_admin@test.local',
  password: 'AttE2eAdmin123',
};

async function registerClient(
  app: INestApplication<App>,
  credentials: { username: string; email: string; password: string },
): Promise<AuthResponseBody> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send(credentials)
    .expect(201);
  return res.body as AuthResponseBody;
}

async function cleanupFixtures(dataSource: DataSource): Promise<void> {
  // Order matters: `tickets.created_by_id` is `ON DELETE RESTRICT` (`docs/data-model.md`
  // §2.7), so tickets must go before users. `attachments.ticket_id` is `ON DELETE CASCADE` from
  // `tickets`, so deleting the tickets below already cascades their attachments — the explicit
  // `DELETE FROM attachments` first is defense in depth, not strictly required, matching the
  // belt-and-braces style of `tickets.e2e-spec.ts`/`ticket-comments.e2e-spec.ts`'s own cleanup.
  await dataSource.query(
    `DELETE FROM attachments WHERE ticket_id IN (SELECT id FROM tickets WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1))`,
    ['att_e2e_%'],
  );
  await dataSource.query(
    `DELETE FROM tickets WHERE created_by_id IN (SELECT id FROM users WHERE username LIKE $1)`,
    ['att_e2e_%'],
  );
  await dataSource.query('DELETE FROM users WHERE username LIKE $1', [
    'att_e2e_%',
  ]);
}

describe('Attachments (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let ticketRepository: Repository<Ticket>;
  let attachmentRepository: Repository<Attachment>;
  let ownerTokens: AuthResponseBody;
  let otherClientTokens: AuthResponseBody;
  let assignedTechTokens: AuthResponseBody;
  let otherTechTokens: AuthResponseBody;
  let adminTokens: AuthResponseBody;
  let assignedTechnicianId: string;
  let categoryId: string;
  // Only set (and only cleaned up) if no active category already existed to reuse — mirrors
  // `tickets.e2e-spec.ts`/`ticket-comments.e2e-spec.ts`: this suite never deletes pre-existing
  // reference data.
  let createdFallbackCategoryId: string | null = null;

  // Fidelity mock of `StorageService`'s public contract (P4 contract, "S3 est mocké en e2e"):
  // S3/MinIO is an external boundary, mocked here for a deterministic test with no infra
  // dependency, while the real Postgres database is used throughout, exactly like every other
  // e2e suite in this project.
  const storageMock = {
    upload: jest.fn<Promise<StoredObject>, [UploadInput]>(),
    getPresignedDownloadUrl: jest.fn<Promise<string>, [string, number?]>(),
    delete: jest.fn<Promise<void>, [string]>(),
  };

  function resetStorageMockToDefaults(): void {
    storageMock.upload.mockImplementation((input: UploadInput) =>
      Promise.resolve({
        key: `${input.keyPrefix ?? 'uploads'}/${randomUUID()}-${input.originalName}`,
        bucket: 'att-e2e-test-bucket',
        mimeType: input.mimeType,
        size: input.size,
      }),
    );
    storageMock.getPresignedDownloadUrl.mockImplementation((key: string) =>
      Promise.resolve(`https://signed.example.com/${key}`),
    );
    storageMock.delete.mockResolvedValue(undefined);
  }

  async function createOwnerTicket(title: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
      .send({
        title,
        description: 'Ticket créé pour couvrir /tickets/:id/attachments.',
        categoryId,
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function uploadAsOwner(
    ticketId: string,
    overrides: {
      filename?: string;
      contentType?: string;
      content?: string;
    } = {},
  ): Promise<AttachmentResponseBody> {
    const res = await request(app.getHttpServer())
      .post(`/api/tickets/${ticketId}/attachments`)
      .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
      .attach('file', Buffer.from(overrides.content ?? 'contenu de test'), {
        filename: overrides.filename ?? 'document.pdf',
        contentType: overrides.contentType ?? 'application/pdf',
      })
      .expect(201);
    return res.body as AttachmentResponseBody;
  }

  async function countAttachments(ticketId: string): Promise<number> {
    const rows = await dataSource.query<CountRow[]>(
      'SELECT COUNT(*)::int AS count FROM attachments WHERE ticket_id = $1',
      [ticketId],
    );
    return rows[0].count;
  }

  beforeAll(async () => {
    // `AttachmentsModule` is wired into `AppModule` (T4.0-bis), so importing `AppModule` alone
    // is what these tests exercise — the same graph the running app boots.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue(storageMock)
      .compile();

    app = moduleFixture.createNestApplication();
    // Mirrors `src/main.ts` exactly: same global prefix and the same `ValidationPipe`
    // configuration the real application boots with.
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    dataSource = app.get(DataSource);
    ticketRepository = dataSource.getRepository(Ticket);
    attachmentRepository = dataSource.getRepository(Attachment);

    resetStorageMockToDefaults();

    // Clean slate: remove any leftover data from a previous, possibly interrupted run before
    // this suite creates its own.
    await cleanupFixtures(dataSource);

    // Reuse an existing active category rather than require one, exactly like the other P4 e2e
    // suites.
    const categoryRepository = dataSource.getRepository(Category);
    const existingCategory = await categoryRepository.findOne({
      where: { isActive: true },
    });
    if (existingCategory) {
      categoryId = existingCategory.id;
    } else {
      const created = await categoryRepository.save(
        categoryRepository.create({
          name: 'Attachments E2E Fallback Category',
          isActive: true,
        }),
      );
      categoryId = created.id;
      createdFallbackCategoryId = created.id;
    }

    ownerTokens = await registerClient(app, OWNER);
    otherClientTokens = await registerClient(app, OTHER_CLIENT);

    const usersService = app.get(UsersService);

    const assignedTechHash = await argon2.hash(ASSIGNED_TECH.password);
    const assignedTechnician = await usersService.create({
      username: ASSIGNED_TECH.username,
      email: ASSIGNED_TECH.email,
      passwordHash: assignedTechHash,
      role: UserRole.TECHNICIAN,
    });
    assignedTechnicianId = assignedTechnician.id;
    const assignedTechLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        identifier: ASSIGNED_TECH.username,
        password: ASSIGNED_TECH.password,
      })
      .expect(200);
    assignedTechTokens = assignedTechLoginRes.body as AuthResponseBody;

    const otherTechHash = await argon2.hash(OTHER_TECH.password);
    await usersService.create({
      username: OTHER_TECH.username,
      email: OTHER_TECH.email,
      passwordHash: otherTechHash,
      role: UserRole.TECHNICIAN,
    });
    const otherTechLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: OTHER_TECH.username, password: OTHER_TECH.password })
      .expect(200);
    otherTechTokens = otherTechLoginRes.body as AuthResponseBody;

    // ADMIN via `UsersService.create()`, not the seeded account — same pattern as
    // `ticket-comments.e2e-spec.ts`, prescribed by this task's own brief.
    const adminHash = await argon2.hash(ADMIN.password);
    await usersService.create({
      username: ADMIN.username,
      email: ADMIN.email,
      passwordHash: adminHash,
      role: UserRole.ADMIN,
    });
    const adminLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: ADMIN.username, password: ADMIN.password })
      .expect(200);
    adminTokens = adminLoginRes.body as AuthResponseBody;
  });

  afterEach(() => {
    // Only invocation history is cleared: the base implementations installed by
    // `resetStorageMockToDefaults()` (and any already-consumed `mockRejectedValueOnce`/
    // `mockResolvedValueOnce` entries) are untouched, so every following test keeps a working
    // default mock unless it deliberately overrides it again.
    storageMock.upload.mockClear();
    storageMock.getPresignedDownloadUrl.mockClear();
    storageMock.delete.mockClear();
  });

  afterAll(async () => {
    await cleanupFixtures(dataSource);
    if (createdFallbackCategoryId) {
      await dataSource.query('DELETE FROM categories WHERE id = $1', [
        createdFallbackCategoryId,
      ]);
    }
    await app.close();
  });

  describe('POST /api/tickets/:id/attachments', () => {
    let ticketId: string;

    beforeAll(async () => {
      ticketId = await createOwnerTicket(
        'Ticket pour les tests POST attachments',
      );
      await ticketRepository.update(ticketId, {
        assigneeId: assignedTechnicianId,
      });
    });

    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/attachments`)
        .attach('file', Buffer.from('contenu'), { filename: 'a.pdf' })
        .expect(401);
    });

    it('returns 404 for a well-formed but non-existent ticket id', async () => {
      await request(app.getHttpServer())
        .post('/api/tickets/00000000-0000-4000-8000-000000000000/attachments')
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .attach('file', Buffer.from('contenu'), { filename: 'a.pdf' })
        .expect(404);
    });

    it('rejects another CLIENT (neither owner nor assignee) with 403 (OwnershipGuard)', async () => {
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/attachments`)
        .set('Authorization', `Bearer ${otherClientTokens.accessToken}`)
        .attach('file', Buffer.from('contenu'), { filename: 'a.pdf' })
        .expect(403);
    });

    it('rejects a TECHNICIAN who is NOT assigned to the ticket with 403 (OwnershipGuard)', async () => {
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/attachments`)
        .set('Authorization', `Bearer ${otherTechTokens.accessToken}`)
        .attach('file', Buffer.from('contenu'), { filename: 'a.pdf' })
        .expect(403);
    });

    it('lets the owner CLIENT upload a file: 201, shaped as AttachmentResponseDto (no storageKey/bucket/uploadedById leak), sizeBytes a number, uploaded via StorageService with the tickets/<id>/attachments key prefix', async () => {
      const content = 'contenu du document';
      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/attachments`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .attach('file', Buffer.from(content), {
          filename: 'rapport.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);

      const body = res.body as AttachmentResponseBody;
      expect(body.id).toEqual(expect.any(String));
      expect(body.originalName).toBe('rapport.pdf');
      expect(body.mimeType).toBe('application/pdf');
      expect(body.sizeBytes).toBe(Buffer.byteLength(content));
      expect(typeof body.sizeBytes).toBe('number');
      expect(body.createdAt).toEqual(expect.any(String));
      expect(typeof body.downloadUrl).toBe('string');
      expect(Object.keys(res.body as object).sort()).toEqual(
        [
          'id',
          'originalName',
          'mimeType',
          'sizeBytes',
          'createdAt',
          'downloadUrl',
        ].sort(),
      );

      expect(storageMock.upload).toHaveBeenCalledTimes(1);
      const uploadArg = storageMock.upload.mock.calls[0][0];
      expect(uploadArg.keyPrefix).toBe(`tickets/${ticketId}/attachments`);
      expect(uploadArg.originalName).toBe('rapport.pdf');
      expect(uploadArg.mimeType).toBe('application/pdf');
    });

    it('rejects an upload with no file attached with 400, and never calls StorageService.upload', async () => {
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/attachments`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .expect(400);

      expect(storageMock.upload).not.toHaveBeenCalled();
    });

    it('propagates a PayloadTooLargeException from StorageService as 413, and writes no attachments row', async () => {
      const isolatedTicketId = await createOwnerTicket(
        'Ticket dédié au test 413',
      );
      storageMock.upload.mockRejectedValueOnce(
        new PayloadTooLargeException('File too large'),
      );

      await request(app.getHttpServer())
        .post(`/api/tickets/${isolatedTicketId}/attachments`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .attach('file', Buffer.from('contenu trop volumineux'), {
          filename: 'trop-gros.pdf',
          contentType: 'application/pdf',
        })
        .expect(413);

      expect(await countAttachments(isolatedTicketId)).toBe(0);
    });

    it('propagates an UnsupportedMediaTypeException from StorageService as 415, and writes no attachments row', async () => {
      const isolatedTicketId = await createOwnerTicket(
        'Ticket dédié au test 415',
      );
      storageMock.upload.mockRejectedValueOnce(
        new UnsupportedMediaTypeException('MIME type not allowed'),
      );

      await request(app.getHttpServer())
        .post(`/api/tickets/${isolatedTicketId}/attachments`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .attach('file', Buffer.from('contenu douteux'), {
          filename: 'suspect.exe',
          contentType: 'application/x-msdownload',
        })
        .expect(415);

      expect(await countAttachments(isolatedTicketId)).toBe(0);
    });
  });

  describe('GET /api/tickets/:id/attachments', () => {
    let ticketId: string;
    let firstAttachmentId: string;
    let secondAttachmentId: string;

    beforeAll(async () => {
      ticketId = await createOwnerTicket(
        'Ticket pour les tests GET attachments',
      );
      await ticketRepository.update(ticketId, {
        assigneeId: assignedTechnicianId,
      });
      const first = await uploadAsOwner(ticketId, { filename: 'un.pdf' });
      const second = await uploadAsOwner(ticketId, { filename: 'deux.pdf' });
      firstAttachmentId = first.id;
      secondAttachmentId = second.id;
    });

    it('rejects a request without an access token with 401', async () => {
      await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/attachments`)
        .expect(401);
    });

    it('returns 404 for a well-formed but non-existent ticket id', async () => {
      await request(app.getHttpServer())
        .get('/api/tickets/00000000-0000-4000-8000-000000000000/attachments')
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .expect(404);
    });

    it('rejects another CLIENT (neither owner nor assignee) with 403 (OwnershipGuard)', async () => {
      await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/attachments`)
        .set('Authorization', `Bearer ${otherClientTokens.accessToken}`)
        .expect(403);
    });

    it('rejects a TECHNICIAN who is NOT assigned to the ticket with 403 (OwnershipGuard)', async () => {
      await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/attachments`)
        .set('Authorization', `Bearer ${otherTechTokens.accessToken}`)
        .expect(403);
    });

    it('returns 200 with an array containing every uploaded attachment, each carrying a downloadUrl resolved via StorageService.getPresignedDownloadUrl', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/attachments`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .expect(200);

      const body = res.body as AttachmentResponseBody[];
      const ids = body.map((a) => a.id);
      expect(ids).toEqual(
        expect.arrayContaining([firstAttachmentId, secondAttachmentId]),
      );
      for (const attachment of body) {
        expect(typeof attachment.downloadUrl).toBe('string');
        expect(Object.keys(attachment).sort()).toEqual(
          [
            'id',
            'originalName',
            'mimeType',
            'sizeBytes',
            'createdAt',
            'downloadUrl',
          ].sort(),
        );
      }
    });

    it('sets downloadUrl to null for an attachment whose presigned URL generation fails, while still returning the other attachment (robustness)', async () => {
      const isolatedTicketId = await createOwnerTicket(
        'Ticket dédié au test downloadUrl null',
      );
      await uploadAsOwner(isolatedTicketId, { filename: 'echoue.pdf' });
      await uploadAsOwner(isolatedTicketId, { filename: 'reussit.pdf' });

      // `AttachmentsService.list` calls `getPresignedDownloadUrl` once per attachment, in the
      // SAME order as the underlying `find({ order: { createdAt: 'ASC' } })` — i.e. upload
      // order, since these two uploads above ran sequentially (awaited), not concurrently.
      storageMock.getPresignedDownloadUrl
        .mockRejectedValueOnce(new Error('simulated presign failure'))
        .mockResolvedValueOnce('https://signed.example.com/second-object');

      const res = await request(app.getHttpServer())
        .get(`/api/tickets/${isolatedTicketId}/attachments`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .expect(200);

      const body = res.body as AttachmentResponseBody[];
      expect(body).toHaveLength(2);
      const [firstBody, secondBody] = body;
      expect(firstBody.originalName).toBe('echoue.pdf');
      expect(firstBody.downloadUrl).toBeNull();
      expect(secondBody.originalName).toBe('reussit.pdf');
      expect(secondBody.downloadUrl).toBe(
        'https://signed.example.com/second-object',
      );
    });
  });

  describe('DELETE /api/tickets/:id/attachments/:attId', () => {
    let ticketId: string;

    beforeAll(async () => {
      ticketId = await createOwnerTicket(
        'Ticket pour les tests DELETE attachments',
      );
      await ticketRepository.update(ticketId, {
        assigneeId: assignedTechnicianId,
      });
    });

    it('rejects a request without an access token with 401', async () => {
      const attachment = await uploadAsOwner(ticketId);
      await request(app.getHttpServer())
        .delete(`/api/tickets/${ticketId}/attachments/${attachment.id}`)
        .expect(401);
    });

    it('returns 404 for a well-formed but non-existent ticket id', async () => {
      await request(app.getHttpServer())
        .delete(
          `/api/tickets/00000000-0000-4000-8000-000000000000/attachments/00000000-0000-4000-8000-000000000000`,
        )
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .expect(404);
    });

    it('rejects another CLIENT (neither owner nor assignee) with 403 (OwnershipGuard, before the attachment is even looked up)', async () => {
      const attachment = await uploadAsOwner(ticketId);
      await request(app.getHttpServer())
        .delete(`/api/tickets/${ticketId}/attachments/${attachment.id}`)
        .set('Authorization', `Bearer ${otherClientTokens.accessToken}`)
        .expect(403);
    });

    it('lets the author soft delete their own attachment: 204, the row still exists in the database with deletedAt set, and StorageService.delete is never called (binary cleanup is deferred past P4)', async () => {
      const attachment = await uploadAsOwner(ticketId);

      await request(app.getHttpServer())
        .delete(`/api/tickets/${ticketId}/attachments/${attachment.id}`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .expect(204);

      const raw = await attachmentRepository.findOne({
        where: { id: attachment.id },
        withDeleted: true,
      });
      expect(raw).not.toBeNull();
      expect(raw?.deletedAt).not.toBeNull();
      expect(storageMock.delete).not.toHaveBeenCalled();

      // Soft-deleted, so a normal (non-`withDeleted`) read no longer returns it: it must also
      // disappear from `GET /attachments`.
      const listRes = await request(app.getHttpServer())
        .get(`/api/tickets/${ticketId}/attachments`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .expect(200);
      const listedIds = (listRes.body as AttachmentResponseBody[]).map(
        (a) => a.id,
      );
      expect(listedIds).not.toContain(attachment.id);
    });

    it('lets an ADMIN (not the author) soft delete an attachment: 204', async () => {
      const attachment = await uploadAsOwner(ticketId);

      await request(app.getHttpServer())
        .delete(`/api/tickets/${ticketId}/attachments/${attachment.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .expect(204);

      const raw = await attachmentRepository.findOne({
        where: { id: attachment.id },
        withDeleted: true,
      });
      expect(raw?.deletedAt).not.toBeNull();
    });

    it('rejects the assigned TECHNICIAN (authorized to see the ticket, but neither the author nor an admin) with 403', async () => {
      const attachment = await uploadAsOwner(ticketId);

      await request(app.getHttpServer())
        .delete(`/api/tickets/${ticketId}/attachments/${attachment.id}`)
        .set('Authorization', `Bearer ${assignedTechTokens.accessToken}`)
        .expect(403);

      const raw = await attachmentRepository.findOne({
        where: { id: attachment.id },
        withDeleted: true,
      });
      expect(raw?.deletedAt).toBeNull();
    });

    it('returns 404 for a well-formed but non-existent attachment id', async () => {
      await request(app.getHttpServer())
        .delete(
          `/api/tickets/${ticketId}/attachments/00000000-0000-4000-8000-000000000000`,
        )
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .expect(404);
    });

    it('returns 404 when the attId belongs to a DIFFERENT ticket than the one in the URL (no cross-ticket leak)', async () => {
      const otherTicketId = await createOwnerTicket(
        "Ticket d'Owner distinct, dont l'attachment ne doit pas être supprimable via le premier ticket",
      );
      const attachmentOnOtherTicket = await uploadAsOwner(otherTicketId);

      await request(app.getHttpServer())
        .delete(
          `/api/tickets/${ticketId}/attachments/${attachmentOnOtherTicket.id}`,
        )
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .expect(404);

      const raw = await attachmentRepository.findOne({
        where: { id: attachmentOnOtherTicket.id },
        withDeleted: true,
      });
      expect(raw?.deletedAt).toBeNull();
    });
  });
});
