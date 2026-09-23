import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

export enum SecurityEvent {
  UserSignedUp = 'user.signed_up',
  BreachedPasswordRejected = 'user.breached_password_rejected',
  SignInSucceeded = 'auth.sign_in_succeeded',
  SignInFailed = 'auth.sign_in_failed',
  SignInLocked = 'auth.sign_in_locked',
  TokenRefreshed = 'auth.token_refreshed',
  RefreshTokenReuseDetected = 'auth.refresh_token_reuse_detected',
  LoggedOut = 'auth.logged_out',
  PasswordChangeRejected = 'auth.password_change_rejected',
  PasswordChanged = 'auth.password_changed',
  AccountRateLimitExceeded = 'account.rate_limit_exceeded',
  EmailVerificationSent = 'user.email_verification_sent',
  EmailVerified = 'user.email_verified',
  PasswordResetRequested = 'auth.password_reset_requested',
  PasswordResetCompleted = 'auth.password_reset_completed',
  UserRoleChanged = 'user.role_changed',
  ProfileUpdated = 'user.profile_updated',
  AccountDeletionRejected = 'user.account_deletion_rejected',
  AccountDeleted = 'user.account_deleted',
}

// Suspicious events log at warn so alerting can key on the level alone.
const WARNING_EVENTS: ReadonlySet<SecurityEvent> = new Set([
  SecurityEvent.AccountRateLimitExceeded,
  SecurityEvent.SignInLocked,
  SecurityEvent.RefreshTokenReuseDetected,
  SecurityEvent.BreachedPasswordRejected,
]);

export type SecurityEventDetails = {
  userId?: string;
  /** Raw email — the service hashes it before logging; plaintext never reaches the logs. */
  email?: string;
  familyId?: string;
  /** Machine-readable action name for rate-limit events, e.g. "verification-email". */
  action?: string;
  /** The role granted by a role-change event. */
  role?: string;
};

const EMAIL_HASH_LENGTH = 16;

// Pseudonymous but stable: events for one account can be grouped without putting PII in logs.
const hashEmail = (email: string): string =>
  createHash('sha256').update(email).digest('hex').slice(0, EMAIL_HASH_LENGTH);

/**
 * The single funnel for security-relevant actions across the app: every event is one structured
 * log entry with a machine-readable `event` field, correlated to its HTTP request by the request
 * id pino already attaches. Alerting and later persistence build on this funnel, not on ad-hoc
 * log lines scattered through services.
 */
@Injectable()
export class SecurityEventsService {
  constructor(
    @InjectPinoLogger(SecurityEventsService.name)
    private readonly logger: PinoLogger,
  ) {}

  record(event: SecurityEvent, details: SecurityEventDetails = {}): void {
    const { email, ...rest } = details;
    const payload = { event, ...rest, ...(email !== undefined ? { emailHash: hashEmail(email) } : {}) };

    if (WARNING_EVENTS.has(event)) {
      this.logger.warn(payload, `Security event: ${event}`);
    } else {
      this.logger.info(payload, `Security event: ${event}`);
    }
  }
}
