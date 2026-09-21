import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/errorCode.js';
import type { ErrorResponseBody } from '../errors/errorResponse.dto.js';

export type { ErrorResponseBody } from '../errors/errorResponse.dto.js';

const RETRY_AFTER_HEADER = 'Retry-After';
const GENERIC_MESSAGE = 'Something went wrong';

/** Code for exceptions that were not thrown as AppException: derived from the status alone. */
const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BadRequest,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.Unauthenticated,
  [HttpStatus.FORBIDDEN]: ErrorCode.Forbidden,
  [HttpStatus.NOT_FOUND]: ErrorCode.NotFound,
  [HttpStatus.CONFLICT]: ErrorCode.Conflict,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PayloadTooLarge,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RateLimited,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.ServiceUnavailable,
};

const codeForStatus = (status: number): ErrorCode => CODE_BY_STATUS[status] ?? ErrorCode.Internal;

interface MiddlewareHttpError {
  name: string;
  message: string;
  status: number;
}

// Express middleware (e.g. body-parser's 413) throws http-errors, not HttpException; 4xx ones carry safe messages.
const isClientMiddlewareError = (exception: unknown): exception is MiddlewareHttpError => {
  const status = (exception as { status?: unknown } | null)?.status;
  return exception instanceof Error && typeof status === 'number' && status >= 400 && status < 500;
};

// 'PayloadTooLargeError' -> 'Payload Too Large'
const humanizeErrorName = (name: string): string => name.replace(/Error$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');

/** The throttler sets Retry-After before throwing; surface it in the body so clients need not read headers. */
const retryAfterSeconds = (response: Response): number | undefined => {
  const header = response.getHeader(RETRY_AFTER_HEADER);
  const seconds = Number(Array.isArray(header) ? header[0] : header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body: ErrorResponseBody = {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      code: ErrorCode.Internal,
      message: GENERIC_MESSAGE,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (exception instanceof AppException) {
      body.statusCode = exception.getStatus();
      body.error = statusText(exception);
      body.code = exception.code;
      body.message = exception.message;
      if (exception.details?.length) {
        body.details = exception.details;
      }
      if (exception.meta) {
        body.meta = exception.meta;
      }
    } else if (exception instanceof HttpException) {
      body.statusCode = exception.getStatus();
      body.code = codeForStatus(body.statusCode);
      const res = exception.getResponse();
      if (typeof res === 'string') {
        body.error = exception.name;
        body.message = res;
      } else {
        const { error, message } = res as { error?: string; message?: string | string[] };
        body.error = error ?? exception.name;
        // A bare ValidationPipe (without our factory) reports each failed rule as a separate message.
        body.message = Array.isArray(message) ? message.join(', ') : (message ?? exception.message);
      }
    } else if (isClientMiddlewareError(exception)) {
      body.statusCode = exception.status;
      body.code = codeForStatus(exception.status);
      body.error = humanizeErrorName(exception.name);
      body.message = exception.message;
    } else {
      // Unexpected errors: log the full details, never leak them to the client.
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }

    if (body.statusCode === HttpStatus.TOO_MANY_REQUESTS && body.meta?.retryAfterSeconds === undefined) {
      const seconds = retryAfterSeconds(response);
      if (seconds !== undefined) {
        body.meta = { ...body.meta, retryAfterSeconds: seconds };
      }
    }

    response.status(body.statusCode).json(body);
  }
}

/** AppException is constructed with a bare message, so the status text comes from Nest's own table. */
const statusText = (exception: HttpException): string => {
  const res = exception.getResponse();
  if (typeof res === 'object' && res !== null && typeof (res as { error?: unknown }).error === 'string') {
    return (res as { error: string }).error;
  }
  return HTTP_STATUS_TEXT[exception.getStatus()] ?? 'Error';
};

const HTTP_STATUS_TEXT: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Payload Too Large',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
};
