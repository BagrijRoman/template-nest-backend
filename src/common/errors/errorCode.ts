/**
 * Stable, machine-readable error codes — the contract clients branch on. Messages may be reworded
 * at any time; a code never changes meaning and is never reused. Add a code here before throwing it.
 */
export enum ErrorCode {
  // Generic, derived from the HTTP status when nothing more specific applies
  BadRequest = 'BAD_REQUEST',
  Unauthenticated = 'UNAUTHENTICATED',
  Forbidden = 'FORBIDDEN',
  NotFound = 'NOT_FOUND',
  Conflict = 'CONFLICT',
  PayloadTooLarge = 'PAYLOAD_TOO_LARGE',
  RateLimited = 'RATE_LIMITED',
  Internal = 'INTERNAL_ERROR',
  ServiceUnavailable = 'SERVICE_UNAVAILABLE',

  // Validation
  ValidationFailed = 'VALIDATION_FAILED',

  // Auth
  InvalidCredentials = 'INVALID_CREDENTIALS',
  InvalidRefreshToken = 'INVALID_REFRESH_TOKEN',
  AccountLocked = 'ACCOUNT_LOCKED',
  WrongCurrentPassword = 'WRONG_CURRENT_PASSWORD',
  InvalidResetToken = 'INVALID_RESET_TOKEN',
  InvalidVerificationToken = 'INVALID_VERIFICATION_TOKEN',
  EmailAlreadyVerified = 'EMAIL_ALREADY_VERIFIED',

  // Users
  EmailTaken = 'EMAIL_TAKEN',
  BreachedPassword = 'BREACHED_PASSWORD',
}
