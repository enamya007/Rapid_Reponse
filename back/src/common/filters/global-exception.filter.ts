import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

const GENERIC_INTERNAL_ERROR_MESSAGE = 'Internal server error';

// Widened to a plain `number`: `statusCode` below is already `number`, and comparing it
// directly against the `HttpStatus` enum member trips
// `@typescript-eslint/no-unsafe-enum-comparison`.
const INTERNAL_SERVER_ERROR_STATUS: number = HttpStatus.INTERNAL_SERVER_ERROR;

export interface NormalizedErrorBody {
  statusCode: number;
  errorCode: string;
  message: string | string[] | Record<string, unknown>;
  timestamp: string;
  path: string;
}

/**
 * Normalizes every error response (thrown `HttpException`s and genuinely unexpected
 * exceptions alike) onto a single, stable shape: `{ statusCode, errorCode, message,
 * timestamp, path }`.
 *
 * Security-critical behaviour:
 * - An exception that is *not* an `HttpException` (a bug, a driver error, anything
 *   unforeseen) always becomes a generic 500 with a fixed, non-informative message. Its
 *   real message and stack are logged server-side (see `catch()` below) but never reach
 *   the client's response body.
 * - `HttpException`s (validation errors included) keep their own `message`, since that
 *   content is intentional, non-sensitive, and useful to the caller (e.g. the array of
 *   per-field validation errors produced by the global `ValidationPipe`).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(GlobalExceptionFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message } = this.resolveStatusAndMessage(exception);
    const errorCode = HttpStatus[statusCode] ?? 'INTERNAL_SERVER_ERROR';

    const body: NormalizedErrorBody = {
      statusCode,
      errorCode,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (statusCode >= INTERNAL_SERVER_ERROR_STATUS) {
      // Full detail (including the stack trace) is only ever written server-side.
      this.logger.error(
        { err: exception, path: request.url, method: request.method },
        'Unhandled exception',
      );
    } else {
      this.logger.warn(
        { path: request.url, method: request.method, statusCode },
        'Handled HTTP exception',
      );
    }

    response.status(statusCode).json(body);
  }

  private resolveStatusAndMessage(exception: unknown): {
    statusCode: number;
    message: string | string[] | Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { statusCode, message: payload };
      }
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'message' in payload
      ) {
        const rawMessage = payload.message;
        if (typeof rawMessage === 'string' || Array.isArray(rawMessage)) {
          return { statusCode, message: rawMessage as string | string[] };
        }
      }
      return { statusCode, message: exception.message };
    }

    // Anything that is not an `HttpException` (thrown by our own code via
    // `ValidationPipe`/built-in exceptions) is, by definition, unforeseen: never trust its
    // message to be safe for a client to see.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: GENERIC_INTERNAL_ERROR_MESSAGE,
    };
  }
}
