import { ArgumentsHost, BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/errorCode.js';
import type { ErrorResponseBody } from '../errors/errorResponse.dto.js';
import { AllExceptionsFilter } from './allExceptions.filter.js';

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  const response = { status: vi.fn(), json: vi.fn(), getHeader: vi.fn() };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/test-path' }),
    }),
  } as unknown as ArgumentsHost;

  const sentBody = (): ErrorResponseBody => response.json.mock.calls[0][0];

  beforeEach(() => {
    vi.resetAllMocks();
    response.status.mockReturnValue(response);
    response.getHeader.mockReturnValue(undefined);
  });

  it('serializes an AppException verbatim: code, details and meta included', () => {
    filter.catch(
      new AppException(HttpStatus.CONFLICT, ErrorCode.EmailTaken, 'Email already exists', {
        details: [{ field: 'email', rule: 'unique', message: 'Email already exists' }],
        meta: { hint: 'sign in instead' },
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(sentBody()).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      code: ErrorCode.EmailTaken,
      message: 'Email already exists',
      details: [{ field: 'email', rule: 'unique', message: 'Email already exists' }],
      meta: { hint: 'sign in instead' },
      path: '/test-path',
    });
    expect(sentBody().timestamp).toBeDefined();
  });

  it('omits details and meta when the AppException carries none', () => {
    filter.catch(
      new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.InvalidCredentials, 'Invalid email or password'),
      host,
    );

    expect(sentBody()).toMatchObject({ statusCode: 401, error: 'Unauthorized', code: ErrorCode.InvalidCredentials });
    expect(sentBody()).not.toHaveProperty('details');
    expect(sentBody()).not.toHaveProperty('meta');
  });

  it('gives a plain Nest HttpException a status-derived code', () => {
    filter.catch(new NotFoundException('User with id "42" not found'), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(sentBody()).toMatchObject({
      statusCode: 404,
      code: ErrorCode.NotFound,
      message: 'User with id "42" not found',
      path: '/test-path',
    });
  });

  it('joins the messages of a bare ValidationPipe exception (one without our factory)', () => {
    filter.catch(new BadRequestException(['email must be a valid email address', 'password too weak']), host);

    expect(sentBody()).toMatchObject({
      statusCode: 400,
      code: ErrorCode.BadRequest,
      message: 'email must be a valid email address, password too weak',
    });
  });

  it('surfaces the throttler Retry-After header as meta.retryAfterSeconds on a 429', () => {
    response.getHeader.mockReturnValue('42');

    filter.catch(new BadRequestException('x'), host);
    expect(sentBody()).not.toHaveProperty('meta');

    response.json.mockClear();
    filter.catch(new AppException(HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RateLimited, 'Too many requests'), host);

    expect(sentBody()).toMatchObject({ code: ErrorCode.RateLimited, meta: { retryAfterSeconds: 42 } });
  });

  it('keeps an explicit retryAfterSeconds over the header', () => {
    response.getHeader.mockReturnValue('42');

    filter.catch(
      new AppException(HttpStatus.TOO_MANY_REQUESTS, ErrorCode.AccountLocked, 'Locked', {
        meta: { retryAfterSeconds: 900 },
      }),
      host,
    );

    expect(sentBody().meta).toEqual({ retryAfterSeconds: 900 });
  });

  it('translates a 4xx http-error thrown by Express middleware', () => {
    const middlewareError = Object.assign(new Error('request entity too large'), {
      name: 'PayloadTooLargeError',
      status: 413,
    });

    filter.catch(middlewareError, host);

    expect(response.status).toHaveBeenCalledWith(413);
    expect(sentBody()).toMatchObject({
      statusCode: 413,
      error: 'Payload Too Large',
      code: ErrorCode.PayloadTooLarge,
      message: 'request entity too large',
    });
  });

  it('treats a 5xx middleware error as unexpected and hides its message', () => {
    const middlewareError = Object.assign(new Error('upstream exploded: secret detail'), { status: 502 });

    filter.catch(middlewareError, host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(sentBody().message).toBe('Something went wrong');
  });

  it('returns a generic 500 for unexpected errors without leaking internals', () => {
    filter.catch(new Error('db password is hunter2'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    const body = sentBody();
    expect(body).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
      code: ErrorCode.Internal,
      message: 'Something went wrong',
    });
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});
