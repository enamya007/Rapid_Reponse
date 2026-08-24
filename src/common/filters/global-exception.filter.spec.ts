import {
  ConflictException,
  Controller,
  Get,
  INestApplication,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  GlobalExceptionFilter,
  NormalizedErrorBody,
} from './global-exception.filter';

// Throwaway fixture controller, defined only in this spec file, exercising the filter
// through the real Nest exception-handling pipeline (not by calling `.catch()` by hand).
@Controller('boom')
class BoomController {
  @Get('unexpected')
  unexpected(): never {
    throw new Error(
      'leaked internal detail: connectionString=postgres://user:hunter2@db-host/prod',
    );
  }

  @Get('conflict')
  conflict(): never {
    throw new ConflictException('Username or email already in use');
  }
}

describe('GlobalExceptionFilter (integration)', () => {
  let app: INestApplication<App>;
  let mockLogger: { error: jest.Mock; warn: jest.Mock };

  beforeAll(async () => {
    mockLogger = { error: jest.fn(), warn: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [BoomController],
      providers: [
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        {
          provide: getLoggerToken(GlobalExceptionFilter.name),
          useValue: mockLogger,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => {
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('turns an unhandled exception into a generic 500 body, leaking no internal detail', async () => {
    const res = await request(app.getHttpServer())
      .get('/boom/unexpected')
      .expect(500);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('connectionString');
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('.ts:'); // no stack trace frame
    expect(res.body).toEqual({
      statusCode: 500,
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      timestamp: expect.any(String) as string,
      path: '/boom/unexpected',
    });
  });

  it('still logs the real error, including the message and stack, server-side', async () => {
    await request(app.getHttpServer()).get('/boom/unexpected').expect(500);

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const [loggedObject] = mockLogger.error.mock.calls[0] as [
      { err: Error },
      string,
    ];
    expect(loggedObject.err).toBeInstanceOf(Error);
    expect(loggedObject.err.message).toContain('connectionString');
    expect(loggedObject.err.stack).toEqual(expect.any(String));
  });

  it('preserves the original status and message for a known HttpException', async () => {
    const res = await request(app.getHttpServer())
      .get('/boom/conflict')
      .expect(409);

    const body = res.body as NormalizedErrorBody;
    expect(body).toMatchObject({
      statusCode: 409,
      errorCode: 'CONFLICT',
      message: 'Username or email already in use',
    });
    expect(body.timestamp).toEqual(expect.any(String));
    expect(body.path).toBe('/boom/conflict');
  });

  it('logs a handled HttpException as a warning, not as an error', async () => {
    await request(app.getHttpServer()).get('/boom/conflict').expect(409);

    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });
});
