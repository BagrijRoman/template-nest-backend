import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception.js';
import { ErrorCode } from './errorCode.js';

// Missing, malformed, expired and forged access tokens are indistinguishable to the caller.
export const INVALID_ACCESS_TOKEN_MESSAGE = 'Invalid or missing access token';

/** The one 401 for "no usable access token" — thrown by the guard and by handlers whose user vanished. */
export const unauthenticatedException = (): AppException =>
  new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.Unauthenticated, INVALID_ACCESS_TOKEN_MESSAGE);

/** The one 403: the caller is authenticated but their role does not allow the route. */
export const forbiddenException = (): AppException =>
  new AppException(HttpStatus.FORBIDDEN, ErrorCode.Forbidden, 'Insufficient permissions');

/** 429 with the wait time in the body, so clients can show "try again in N minutes". */
export const rateLimitedException = (code: ErrorCode, message: string, retryAfterSeconds: number): AppException =>
  new AppException(HttpStatus.TOO_MANY_REQUESTS, code, message, { meta: { retryAfterSeconds } });
