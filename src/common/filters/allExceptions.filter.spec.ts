import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter, ErrorResponseBody } from './allExceptions.filter.js';

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  const response = { status: vi.fn(), json: vi.fn() };
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
  });

  it('translates an HttpException with a plain message', () => {
    filter.catch(new NotFoundException('User with id "42" not found'), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(sentBody()).toMatchObject({
      statusCode: 404,
      message: 'User with id "42" not found',
      path: '/test-path',
    });
    expect(sentBody().timestamp).toBeDefined();
  });

  it('collects ValidationPipe messages into details', () => {
    filter.catch(new BadRequestException(['email must be a valid email address', 'password too weak']), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(sentBody()).toMatchObject({
      statusCode: 400,
      message: 'Validation failed',
      details: ['email must be a valid email address', 'password too weak'],
    });
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
      message: 'Something went wrong',
    });
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('handles non-Error throws with a generic 500', () => {
    filter.catch('just a string', host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(sentBody().message).toBe('Something went wrong');
  });
});
